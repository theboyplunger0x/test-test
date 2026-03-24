import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db/client.js";
import { createHmac } from "node:crypto";

const TWITTERAPI_KEY  = process.env.TWITTERAPI_KEY!;
const API             = process.env.BACKEND_URL || "http://localhost:3001";
const FUDMARKETS_UID  = "426916379898642432"; // @FUDmarkets X user ID

const anthropic = new Anthropic();

// Track last processed mention to avoid duplicates across polls
let lastMentionId: string | null = null;

// ─── Auth helpers (same as telegram-bot) ─────────────────────────────────────

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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
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

// ─── TwitterAPI.io ────────────────────────────────────────────────────────────

async function fetchMentions(): Promise<any[]> {
  const params = new URLSearchParams({ userId: FUDMARKETS_UID });
  if (lastMentionId) params.set("sinceId", lastMentionId);

  const res = await fetch(`https://api.twitterapi.io/twitter/user/mentions?${params}`, {
    headers: { "X-API-Key": TWITTERAPI_KEY },
  });

  if (!res.ok) {
    console.error(`[X] TwitterAPI error: ${res.status}`);
    return [];
  }

  const data = await res.json() as any;
  return data.tweets ?? [];
}

// ─── AI System prompt ─────────────────────────────────────────────────────────

const SYSTEM = `You are FUD — the AI agent of FUD.markets, a prediction markets platform where users bet LONG or SHORT on crypto prices.

You're operating on X (Twitter). Users mention @FUDmarkets to interact with you.

Personality:
- Casual, sharp, slightly sarcastic but not forced
- Short responses — max 2-3 sentences + any relevant data
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

Keep responses under 280 characters when possible.`;

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_token",
    description: "Search a token by name or ticker to get live price, mcap, and chain",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Token name or ticker symbol" } },
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
        symbol:    { type: "string", description: "Token ticker, e.g. PEPE" },
        chain:     { type: "string", description: "Chain: SOL, BASE, ETH, BSC" },
        timeframe: { type: "string", description: "Timeframe: 1m, 5m, 15m, 1h, 4h, 12h, 24h" },
        paper:     { type: "boolean", description: "true for paper mode, false for real" },
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
        amount:   { type: "number", description: "Amount in USD" },
        paper:    { type: "boolean", description: "true for paper mode" },
      },
      required: ["marketId", "side", "amount"],
    },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

async function runTool(
  name: string,
  input: any,
  fudUser: any,
  token: string | null
): Promise<string> {
  if (name === "search_token") {
    const res  = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(input.query)}`);
    const data = await res.json() as any;
    const pair = data.pairs?.[0];
    if (!pair) return "Token not found on DexScreener";
    const mcap = pair.marketCap ? `$${Number(pair.marketCap).toLocaleString()}` : "N/A";
    return `${pair.baseToken.symbol} | ${pair.chainId} | $${pair.priceUsd} | mcap: ${mcap}`;
  }

  if (name === "get_open_markets") {
    const markets = await fetch(`${API}/markets`).then(r => r.json()) as any[];
    if (!markets.length) return "No open markets right now";
    return markets
      .slice(0, 5)
      .map((m: any) => `${m.symbol} ${m.timeframe} | L:$${m.long_pool} S:$${m.short_pool}`)
      .join("\n");
  }

  if (name === "get_user_balance") {
    if (!fudUser) return "User has no linked FUD account";
    return `Real: $${fudUser.balance_usd} | Paper: $${fudUser.paper_balance_usd}`;
  }

  if (name === "create_market") {
    if (!token || !fudUser) return "Cannot create market: user has no linked FUD account";
    const market = await apiFetch("/markets", token, {
      method: "POST",
      body: JSON.stringify({
        symbol:    input.symbol,
        chain:     input.chain,
        timeframe: input.timeframe,
        paper:     input.paper ?? false,
      }),
    });
    return `Market created — ID: ${market.id} | ${market.symbol} ${market.timeframe} | entry: $${market.entry_price}`;
  }

  if (name === "place_bet") {
    if (!token || !fudUser) return "Cannot place bet: user has no linked FUD account";
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

  console.log(`\n[@${xUsername}] ${text}`);

  const fudUser = xUsername ? await getUserByXUsername(xUsername) : null;
  const token   = fudUser ? mintToken(fudUser.id, fudUser.username) : null;

  if (fudUser) {
    console.log(`  → FUD account: ${fudUser.username} | $${fudUser.balance_usd} real / $${fudUser.paper_balance_usd} paper`);
  } else {
    console.log(`  → No linked FUD account`);
  }

  const userContext = fudUser
    ? `\n\nThis user has a linked FUD account: "${fudUser.username}" (real: $${fudUser.balance_usd}, paper: $${fudUser.paper_balance_usd})`
    : `\n\nThis user has NO linked FUD account.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Tweet from @${xUsername}: "${text}"${userContext}` },
  ];

  let response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system:     SYSTEM,
    tools:      TOOLS,
    messages,
  });

  // Agentic loop
  while (response.stop_reason === "tool_use") {
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const t of toolUses) {
      let result: string;
      try {
        result = await runTool(t.name, t.input as any, fudUser, token);
      } catch (e: any) {
        result = `Error: ${e.message}`;
      }
      console.log(`  [tool] ${t.name} → ${result}`);
      results.push({ type: "tool_result", tool_use_id: t.id, content: result });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user",      content: results });

    response = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system:     SYSTEM,
      tools:      TOOLS,
      messages,
    });
  }

  const reply = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  console.log(`  → REPLY (${reply.length} chars): ${reply}`);

  // TODO: post reply via X API
  // await postReply(tweetId, `@${xUsername} ${reply}`);

  return reply;
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const mentions = await fetchMentions();

    if (!mentions.length) {
      console.log(`[${new Date().toISOString()}] No new mentions`);
      return;
    }

    // Update cursor (most recent ID first in response)
    lastMentionId = mentions[0].id;

    // Process oldest first
    for (const tweet of [...mentions].reverse()) {
      await processMention(tweet);
    }
  } catch (e: any) {
    console.error(`[poll] Error: ${e.message}`);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function startXAgent() {
  if (!TWITTERAPI_KEY) {
    console.log("[x-agent] TWITTERAPI_KEY not set — skipping");
    return;
  }
  console.log("[x-agent] Starting — monitoring @FUDmarkets");
  await poll();
  setInterval(poll, 30_000);
}
