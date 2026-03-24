import Anthropic from "@anthropic-ai/sdk";
import { TwitterApi } from "twitter-api-v2";
import { db } from "../db/client.js";
import { createHmac } from "node:crypto";

const TWITTERAPI_KEY = process.env.TWITTERAPI_KEY!;
const API            = process.env.BACKEND_URL || "http://localhost:3001";
const FUDMARKETS_UID = "426916379898642432"; // @FUDmarkets X user ID
const ADMIN_TG_ID    = process.env.ADMIN_TG_ID!; // your Telegram chat ID

const anthropic = new Anthropic();

// X client for posting replies
const xClient = new TwitterApi({
  appKey:       process.env.X_API_KEY!,
  appSecret:    process.env.X_API_SECRET!,
  accessToken:  process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
});

// Pending approvals: callbackId → { tweetId, xUsername, reply, timeout }
const pending = new Map<string, {
  tweetId:   string;
  xUsername: string;
  reply:     string;
  timeout:   ReturnType<typeof setTimeout>;
}>();

let lastMentionId: string | null = null;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function mintToken(userId: string, username: string): string {
  const secret  = process.env.JWT_SECRET!;
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ userId, username })).toString("base64url");
  const sig     = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getUserByXUsername(xUsername: string) {
  const { rows } = await db.query(
    `SELECT id, username, balance_usd, paper_balance_usd FROM users WHERE x_username = $1`,
    [xUsername.toLowerCase()]
  );
  return rows[0] ?? null;
}

// ─── Filter: should we process this mention? ─────────────────────────────────

async function shouldProcess(tweet: any): Promise<{ ok: boolean; reason: string }> {
  const author = tweet.author ?? {};

  // 1. Linked FUD account → always process
  const fudUser = await getUserByXUsername((author.userName ?? "").toLowerCase());
  if (fudUser) return { ok: true, reason: "linked FUD account" };

  // 2. X blue verified → process
  if (author.isBlueVerified === true) return { ok: true, reason: "blue verified" };

  // 3. Everything else → skip
  return { ok: false, reason: "not linked and not verified" };
}

// ─── Telegram notification ───────────────────────────────────────────────────

async function sendToAdminTelegram(text: string, inlineKeyboard?: object) {
  if (!ADMIN_TG_ID || !process.env.BOT_TOKEN) return;
  const body: any = { chat_id: ADMIN_TG_ID, text, parse_mode: "Markdown" };
  if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

// Called by Telegram bot when admin taps ✅ or ❌
export async function handleXApproval(callbackId: string, approved: boolean) {
  const entry = pending.get(callbackId);
  if (!entry) return "expired";

  clearTimeout(entry.timeout);
  pending.delete(callbackId);

  if (approved) {
    try {
      await xClient.v2.reply(entry.reply, entry.tweetId);
      console.log(`[x-agent] Posted reply to @${entry.xUsername}`);
      return "posted";
    } catch (e: any) {
      console.error(`[x-agent] Failed to post reply: ${e.message}`);
      return "error";
    }
  } else {
    console.log(`[x-agent] Reply to @${entry.xUsername} rejected`);
    return "rejected";
  }
}

// ─── AI System prompt ─────────────────────────────────────────────────────────

const SYSTEM = `You are FUD — the AI agent of FUD.markets, a prediction markets platform where users bet LONG or SHORT on crypto prices.

You're operating on X (Twitter). Users mention @FUDmarkets to interact with you.

Personality:
- Casual, sharp, slightly sarcastic but not forced
- Short responses — max 2-3 sentences + relevant data
- Switch to Spanish if the user writes in Spanish
- Never use forced crypto slang

What you can do:
- Search tokens and show live price/mcap
- Show open prediction markets
- Check the user's FUD balance (only if they have a linked account)
- Create a new prediction market for a token (requires linked account)
- Place a long or short bet (requires linked account)

When a user wants to trade (e.g. "long $PEPE 1h $25"):
1. Search the token to get live price and chain
2. Create the market if none exists for that symbol/timeframe
3. Place the bet on that market
4. Confirm the result

If the user has no linked FUD account, tell them to go to fud.markets and connect their X handle in settings. Keep it brief.

Keep responses under 270 characters — tweet length.`;

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_token",
    description: "Search a token by name or ticker to get live price, mcap, and chain",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_open_markets",
    description: "Get the list of currently open prediction markets on FUD.markets",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_user_balance",
    description: "Get the real and paper balance of the linked FUD user",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "create_market",
    description: "Create a new prediction market for a token. Requires linked FUD account.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol:    { type: "string" },
        chain:     { type: "string", description: "SOL, BASE, ETH, BSC" },
        timeframe: { type: "string", description: "1m, 5m, 15m, 1h, 4h, 12h, 24h" },
        paper:     { type: "boolean" },
      },
      required: ["symbol", "chain", "timeframe"],
    },
  },
  {
    name: "place_bet",
    description: "Place a long or short bet on an open market. Requires linked FUD account.",
    input_schema: {
      type: "object" as const,
      properties: {
        marketId: { type: "string" },
        side:     { type: "string", description: "long or short" },
        amount:   { type: "number" },
        paper:    { type: "boolean" },
      },
      required: ["marketId", "side", "amount"],
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

async function runTool(name: string, input: any, fudUser: any, token: string | null): Promise<string> {
  if (name === "search_token") {
    const res  = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(input.query)}`);
    const data = await res.json() as any;
    const pair = data.pairs?.[0];
    if (!pair) return "Token not found";
    const mcap = pair.marketCap ? `$${Number(pair.marketCap).toLocaleString()}` : "N/A";
    return `${pair.baseToken.symbol} | ${pair.chainId} | $${pair.priceUsd} | mcap: ${mcap}`;
  }
  if (name === "get_open_markets") {
    const markets = await fetch(`${API}/markets`).then(r => r.json()) as any[];
    if (!markets.length) return "No open markets";
    return markets.slice(0, 5).map((m: any) => `${m.symbol} ${m.timeframe} L:$${m.long_pool} S:$${m.short_pool}`).join("\n");
  }
  if (name === "get_user_balance") {
    if (!fudUser) return "No linked FUD account";
    return `Real: $${fudUser.balance_usd} | Paper: $${fudUser.paper_balance_usd}`;
  }
  if (name === "create_market") {
    if (!token || !fudUser) return "Cannot create market: no linked FUD account";
    const market = await apiFetch("/markets", token, {
      method: "POST",
      body: JSON.stringify({ symbol: input.symbol, chain: input.chain, timeframe: input.timeframe, paper: input.paper ?? false }),
    });
    return `Market created — ID: ${market.id} | ${market.symbol} ${market.timeframe} | entry: $${market.entry_price}`;
  }
  if (name === "place_bet") {
    if (!token || !fudUser) return "Cannot place bet: no linked FUD account";
    const bet = await apiFetch(`/markets/${input.marketId}/bet`, token, {
      method: "POST",
      body: JSON.stringify({ side: input.side, amount: input.amount, paper: input.paper ?? false }),
    });
    return `Bet placed — ${input.side.toUpperCase()} $${input.amount} | multiplier: ${bet.multiplier}x`;
  }
  return "Unknown tool";
}

// ─── Process a single mention ─────────────────────────────────────────────────

async function processMention(tweet: any) {
  const xUsername = (tweet.author?.userName ?? "").toLowerCase();
  const text      = tweet.text?.replace(/@FUDmarkets/gi, "").trim() ?? "";
  const tweetId   = tweet.id;
  const tweetUrl  = `https://x.com/${xUsername}/status/${tweetId}`;

  // ── Filter ──
  const { ok, reason } = await shouldProcess(tweet);
  if (!ok) {
    console.log(`[x-agent] Skipped @${xUsername} — ${reason}`);
    return;
  }
  console.log(`\n[x-agent] Processing @${xUsername} (${reason}): ${text}`);

  const fudUser = await getUserByXUsername(xUsername);
  const token   = fudUser ? mintToken(fudUser.id, fudUser.username) : null;

  const userContext = fudUser
    ? `\n\nLinked FUD account: "${fudUser.username}" (real: $${fudUser.balance_usd}, paper: $${fudUser.paper_balance_usd})`
    : `\n\nNo linked FUD account.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Tweet from @${xUsername}: "${text}"${userContext}` },
  ];

  let response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001", max_tokens: 512,
    system: SYSTEM, tools: TOOLS, messages,
  });

  while (response.stop_reason === "tool_use") {
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      let result: string;
      try { result = await runTool(t.name, t.input as any, fudUser, token); }
      catch (e: any) { result = `Error: ${e.message}`; }
      console.log(`  [tool] ${t.name} → ${result}`);
      results.push({ type: "tool_result", tool_use_id: t.id, content: result });
    }
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: results });
    response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 512,
      system: SYSTEM, tools: TOOLS, messages,
    });
  }

  const reply = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  console.log(`  → Draft reply: ${reply}`);

  // ── Send to admin Telegram for approval ──
  const callbackId = `x_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const notif = `*X mention from @${xUsername}*\n\n` +
    `_"${text}"_\n\n` +
    `*Draft reply:*\n${reply}\n\n` +
    `[View tweet](${tweetUrl})`;

  await sendToAdminTelegram(notif, [
    [
      { text: "✅ Post",   callback_data: `xapprove_${callbackId}` },
      { text: "❌ Reject", callback_data: `xreject_${callbackId}` },
    ],
  ]);

  // Auto-reject after 30 minutes
  const timeout = setTimeout(() => {
    if (pending.has(callbackId)) {
      pending.delete(callbackId);
      console.log(`[x-agent] Auto-rejected reply to @${xUsername} (30min timeout)`);
    }
  }, 30 * 60 * 1000);

  pending.set(callbackId, { tweetId, xUsername, reply, timeout });
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const params = new URLSearchParams({ userId: FUDMARKETS_UID });
    if (lastMentionId) params.set("sinceId", lastMentionId);
    const res  = await fetch(`https://api.twitterapi.io/twitter/user/mentions?${params}`, {
      headers: { "X-API-Key": TWITTERAPI_KEY },
    });
    if (!res.ok) { console.error(`[x-agent] Poll error: ${res.status}`); return; }
    const data     = await res.json() as any;
    const mentions = data.tweets ?? [];
    if (!mentions.length) { console.log(`[x-agent] ${new Date().toISOString()} — no new mentions`); return; }
    lastMentionId = mentions[0].id;
    for (const tweet of [...mentions].reverse()) await processMention(tweet);
  } catch (e: any) {
    console.error(`[x-agent] Poll error: ${e.message}`);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function startXAgent() {
  if (!TWITTERAPI_KEY) { console.log("[x-agent] TWITTERAPI_KEY not set — skipping"); return; }
  console.log("[x-agent] Starting — monitoring @FUDmarkets");
  await poll();
  setInterval(poll, 30_000);
}
