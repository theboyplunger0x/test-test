import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";
import { createHmac } from "node:crypto";

const TWITTERAPI_KEY      = process.env.TWITTERAPI_KEY!;
const API                 = process.env.BACKEND_URL || "http://localhost:3001";
const FUDMARKETS_USERNAME = "FUDmarkets";
const TW_USERNAME         = process.env.X_TWITTER_USERNAME || FUDMARKETS_USERNAME;
const TW_PASSWORD         = process.env.X_TWITTER_PASSWORD!;
const TW_EMAIL            = process.env.X_TWITTER_EMAIL!;
const TW_PROXY            = process.env.X_PROXY_URL;
const TW_TOTP_SECRET      = process.env.X_TWITTER_TOTP_SECRET;
const X_API_KEY           = process.env.X_API_KEY!;
const X_API_SECRET        = process.env.X_API_SECRET!;
const X_ACCESS_TOKEN      = process.env.X_ACCESS_TOKEN!;
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET!;

// Support up to 2 admin Telegram chat IDs
const ADMIN_TG_IDS: string[] = [
  process.env.ADMIN_TG_ID,
  process.env.ADMIN_TG_ID_2,
].filter(Boolean) as string[];

const anthropic = new Anthropic();

// ─── twitterapi.io cookie-based posting ──────────────────────────────────────

let cachedCookies: string | null = null;

async function loadCookies(): Promise<string | null> {
  if (cachedCookies) return cachedCookies;
  try {
    const { rows } = await db.query(`SELECT value FROM bot_kv WHERE key = 'x_login_cookies'`);
    if (rows[0]) { cachedCookies = rows[0].value; return cachedCookies; }
  } catch {}
  return null;
}

async function saveCookies(cookies: string) {
  cachedCookies = cookies;
  await db.query(
    `INSERT INTO bot_kv (key, value) VALUES ('x_login_cookies', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [cookies]
  );
}

async function twitterLogin(retries = 5): Promise<string | null> {
  console.log("[x-agent] Logging in to Twitter via twitterapi.io...");
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch("https://api.twitterapi.io/twitter/user_login_v2", {
        method:  "POST",
        headers: { "X-API-Key": TWITTERAPI_KEY, "Content-Type": "application/json" },
        body:    JSON.stringify({ user_name: TW_USERNAME, password: TW_PASSWORD, email: TW_EMAIL, ...(TW_PROXY ? { proxy: TW_PROXY } : {}), ...(TW_TOTP_SECRET ? { totp_secret: TW_TOTP_SECRET } : {}) }),
      });
      const data = await res.json() as any;
      if (res.status === 429) {
        console.warn(`[x-agent] Login 429 — retrying in 6s (attempt ${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, 6000));
        continue;
      }
      if (!res.ok || !data.login_cookies) {
        console.error(`[x-agent] Login failed: ${JSON.stringify(data)}`);
        return null;
      }
      console.log("[x-agent] Twitter login successful — cookies saved");
      await saveCookies(data.login_cookies);
      return data.login_cookies;
    } catch (e: any) {
      console.error(`[x-agent] Login error: ${e.message}`);
      return null;
    }
  }
  console.error("[x-agent] Login failed after retries");
  return null;
}

function buildOAuthHeader(method: string, url: string): string {
  const nonce     = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     X_API_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        timestamp,
    oauth_token:            X_ACCESS_TOKEN,
    oauth_version:          "1.0",
  };
  const sortedParams = Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
    .join("&");
  const base      = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(X_API_SECRET)}&${encodeURIComponent(X_ACCESS_TOKEN_SECRET)}`;
  const signature  = createHmac("sha1", signingKey).update(base).digest("base64");
  oauthParams.oauth_signature = signature;
  return "OAuth " + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(", ");
}

async function postReply(text: string, replyToId: string): Promise<void> {
  const url  = "https://api.twitter.com/2/tweets";
  const body: any = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };

  console.log(`[x-agent] POST /2/tweets replyToId=${replyToId} text="${text.slice(0, 100)}"`);
  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Authorization": buildOAuthHeader("POST", url), "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await res.json() as any;
  console.log(`[x-agent] POST /2/tweets status=${res.status} response=${JSON.stringify(data).slice(0, 300)}`);
  if (!res.ok) throw new Error(JSON.stringify(data));
}

// ─── twitterapi.io v3 (server-side session, no cookie needed for posting) ────

let v3LoginDone = false;

async function loginV3(): Promise<boolean> {
  console.log("[x-agent] Initiating v3 login...");
  try {
    const res = await fetch("https://api.twitterapi.io/twitter/user_login_v3", {
      method:  "POST",
      headers: { "X-API-Key": TWITTERAPI_KEY, "Content-Type": "application/json" },
      body:    JSON.stringify({
        user_name: TW_USERNAME,
        email:     TW_EMAIL,
        password:  TW_PASSWORD,
        proxy:     TW_PROXY,
      }),
    });
    const data = await res.json() as any;
    console.log(`[x-agent] v3 login init: ${JSON.stringify(data).slice(0, 200)}`);
    if (!res.ok || data.status !== "success") return false;

    // Poll until Active (max 60s)
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await fetch(`https://api.twitterapi.io/twitter/get_my_x_account_detail_v3?user_name=${TW_USERNAME}`, {
        headers: { "X-API-Key": TWITTERAPI_KEY },
      });
      const pd = await poll.json() as any;
      console.log(`[x-agent] v3 poll ${i + 1}: status=${pd.data?.status}`);
      if (pd.data?.status === "Active") {
        console.log("[x-agent] v3 session active");
        v3LoginDone = true;
        return true;
      }
    }
    console.error("[x-agent] v3 login timed out");
    return false;
  } catch (e: any) {
    console.error("[x-agent] v3 login error:", e.message);
    return false;
  }
}

async function postV3(text: string): Promise<void> {
  if (!v3LoginDone) {
    const ok = await loginV3();
    if (!ok) throw new Error("v3 login failed");
  }
  console.log(`[x-agent] send_tweet_v3 text="${text.slice(0, 100)}"`);
  const res = await fetch("https://api.twitterapi.io/twitter/send_tweet_v3", {
    method:  "POST",
    headers: { "X-API-Key": TWITTERAPI_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify({ user_name: TW_USERNAME, text }),
  });
  const data = await res.json() as any;
  console.log(`[x-agent] send_tweet_v3 status=${res.status} response=${JSON.stringify(data).slice(0, 300)}`);
  if (!res.ok || data.status !== "success") throw new Error(JSON.stringify(data));
}

// Pending approvals: callbackId → { tweetId, xUsername, replies, timeout, msgIds }
const pending = new Map<string, {
  tweetId:   string;
  xUsername: string;
  replies:   string[];            // 3 generated variants
  timeout:   ReturnType<typeof setTimeout>;
  msgIds:    Map<string, number>; // chatId → messageId (for editing after decision)
}>();

let lastPollTime: number = Math.floor(Date.now() / 1000) - 300; // default: 5 min ago
const processedIds = new Set<string>(); // dedup within a session

async function loadLastPollTime() {
  try {
    const { rows } = await db.query(`SELECT value FROM bot_kv WHERE key = 'x_last_poll_time'`);
    if (rows[0]) { lastPollTime = parseInt(rows[0].value); console.log(`[x-agent] Loaded lastPollTime=${lastPollTime}`); }
  } catch {}
}

async function saveLastPollTime(t: number) {
  try {
    await db.query(
      `INSERT INTO bot_kv (key, value) VALUES ('x_last_poll_time', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [t.toString()]
    );
  } catch {}
}

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

// ─── Cooldown: max 5 mentions per user per 10 minutes ────────────────────────

const cooldowns = new Map<string, number[]>(); // xUsername → timestamps

function checkCooldown(xUsername: string): boolean {
  const now    = Date.now();
  const window = 10 * 60 * 1000; // 10 minutes
  const limit  = 5;
  const times  = (cooldowns.get(xUsername) ?? []).filter(t => now - t < window);
  if (times.length >= limit) return false; // blocked
  cooldowns.set(xUsername, [...times, now]);
  return true;
}

// ─── Content filter: skip empty/emoji-only/too-short mentions ────────────────

function hasSubstance(text: string): boolean {
  // Strip @mentions, URLs, emojis, punctuation and check if anything real remains
  const stripped = text
    .replace(/@\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ\s$]/g, "")
    .trim();
  // Need at least 1 real word
  const words = stripped.split(/\s+/).filter(w => w.length > 0);
  return words.length >= 1;
}

// ─── Filter: should we process this mention? ─────────────────────────────────

async function shouldProcess(tweet: any): Promise<{ ok: boolean; reason: string }> {
  const xUsername = (tweet.author?.userName ?? "").toLowerCase();
  const text      = (tweet.text ?? "").replace(/@FUDmarkets/gi, "").trim();

  // 1. Content filter — skip emoji-only / completely empty
  if (!hasSubstance(text)) return { ok: false, reason: `no substance (text="${text}")` };

  // 2. Cooldown — max 5 per user per 10 min
  if (!checkCooldown(xUsername)) return { ok: false, reason: "cooldown" };

  // 3. Everyone else passes — linked users, verified, and regular users all welcome
  return { ok: true, reason: "ok" };
}

// ─── Telegram notification ───────────────────────────────────────────────────

/** Send a message to all admin chats. Returns Map<chatId, messageId> for later editing. */
async function sendToAdminTelegram(text: string, inlineKeyboard?: object): Promise<Map<string, number>> {
  const msgIds = new Map<string, number>();
  if (!ADMIN_TG_IDS.length || !process.env.BOT_TOKEN) {
    console.warn("[x-agent] sendToAdminTelegram skipped — ADMIN_TG_IDS or BOT_TOKEN not set");
    return msgIds;
  }
  for (const chatId of ADMIN_TG_IDS) {
    const body: any = { chat_id: chatId, text, parse_mode: "Markdown" };
    if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
    try {
      const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json() as any;
        msgIds.set(chatId, data.result?.message_id);
      } else {
        const err = await res.text();
        console.error(`[x-agent] Telegram send to ${chatId} failed: ${res.status} ${err}`);
      }
    } catch (e: any) {
      console.error(`[x-agent] Telegram send to ${chatId} error: ${e.message}`);
    }
  }
  return msgIds;
}

/** Edit a previously sent message (removes buttons, shows status). */
async function editAdminMessages(msgIds: Map<string, number>, text: string) {
  if (!process.env.BOT_TOKEN) return;
  for (const [chatId, messageId] of msgIds) {
    try {
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/editMessageText`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "Markdown" }),
      });
    } catch {}
  }
}

// ─── Export helpers for Telegram bot ─────────────────────────────────────────

/** Post one of the generated reply variants */
export async function handleXPost(callbackId: string, replyIndex: number): Promise<string> {
  const entry = pending.get(callbackId);
  if (!entry) return "expired";
  clearTimeout(entry.timeout);
  pending.delete(callbackId);
  const reply = entry.replies[replyIndex] ?? entry.replies[0];
  try {
    await postReply(reply, entry.tweetId);
    console.log(`[x-agent] Posted opt ${replyIndex + 1} to @${entry.xUsername}: ${reply}`);
    await editAdminMessages(entry.msgIds, `✅ *Posted* (opt ${replyIndex + 1})\n\n_${reply}_`);
    return "posted";
  } catch (e: any) {
    console.error(`[x-agent] Failed to post: ${e.message}`);
    await editAdminMessages(entry.msgIds, `⚠️ *Error posting*: ${e.message}`);
    return "error";
  }
}

/** Post a custom (manually edited) reply */
export async function handleXPostCustom(callbackId: string, customReply: string): Promise<string> {
  const entry = pending.get(callbackId);
  if (!entry) return "expired";
  clearTimeout(entry.timeout);
  pending.delete(callbackId);
  const reply = customReply;
  try {
    await postReply(reply, entry.tweetId);
    console.log(`[x-agent] Posted custom reply to @${entry.xUsername}`);
    await editAdminMessages(entry.msgIds, `✅ *Posted* (custom)\n\n_${customReply}_`);
    return "posted";
  } catch (e: any) {
    console.error(`[x-agent] Failed to post custom: ${e.message}`);
    return "error";
  }
}

/** Reject — discard all variants */
export async function handleXReject(callbackId: string): Promise<string> {
  const entry = pending.get(callbackId);
  if (!entry) return "expired";
  clearTimeout(entry.timeout);
  pending.delete(callbackId);
  console.log(`[x-agent] Rejected reply to @${entry.xUsername}`);
  await editAdminMessages(entry.msgIds, `❌ *Rejected* — @${entry.xUsername}`);
  return "rejected";
}

/** Read pending entry (used by Telegram edit flow) */
export function getXPending(callbackId: string) {
  return pending.get(callbackId);
}

// ─── AI System prompt ─────────────────────────────────────────────────────────

const FRONTEND = process.env.FRONTEND_URL || "https://fud-markets.vercel.app";

const SYSTEM = `You are the FUD.markets bot on X (Twitter). You execute trades and reply with confirmations.

Rules:
- Replies must be under 270 characters.
- Be concise and functional. No slang, no hype, no filler.
- Vary your confirmations slightly so they don't all sound identical. Examples:
  "Hey @user, long opened! $PEPE 1h $25 — {link}"
  "@user long is live! $PEPE 1h $25 — {link}"
  "@user done! Longing $PEPE 1h for $25 — {link}"
  "@user your short is in. $DOGE 4h $50 — {link}"
- Always include the trade link: ${FRONTEND}
- Reply in the same language the user wrote in.

When a user wants to trade (e.g. "long $PEPE 1h $25"):
1. Search the token to get price and chain.
2. Create the market if none exists for that symbol/timeframe. Use a short tagline derived from the user's tweet (max 60 chars).
3. Place the bet. Use the user's tweet (stripped of @mentions, max 80 chars) as the trader message.
4. Reply with: side, token, timeframe, amount, and the link.

If the user is missing required info (side, token, amount, or timeframe), reply asking them to include it. Be helpful:
  "@user need a timeframe to open this — try: long $PEPE 1h $25"
  "@user what amount? Example: short $DOGE 4h $50"

If no linked FUD account: "@user link your X on fud.markets to start trading."

Market context (use if relevant):
- You have access to open markets and recent activity via tools.
- If a user asks what's hot or trending, use get_open_markets.`;


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
        tagline:   { type: "string", description: "Punchy opener message derived from the tweet, max 60 chars" },
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
        message:  { type: "string", description: "Trader message derived from the tweet, max 80 chars" },
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
      body: JSON.stringify({ symbol: input.symbol, chain: input.chain, timeframe: input.timeframe, tagline: input.tagline ?? "", paper: input.paper ?? false }),
    });
    return `Market created — ID: ${market.id} | ${market.symbol} ${market.timeframe} | entry: $${market.entry_price} | link: ${FRONTEND}`;
  }
  if (name === "place_bet") {
    if (!token || !fudUser) return "Cannot place bet: no linked FUD account";
    const bet = await apiFetch(`/markets/${input.marketId}/bet`, token, {
      method: "POST",
      body: JSON.stringify({ side: input.side, amount: input.amount, message: input.message ?? undefined, paper: input.paper ?? false }),
    });
    return `Bet placed — ${input.side.toUpperCase()} $${input.amount} | new balance: $${bet.new_balance} | link: ${FRONTEND}`;
  }
  return "Unknown tool";
}

// ─── Process a single mention ─────────────────────────────────────────────────

async function processMention(tweet: any) {
  const xUsername = (tweet.author?.userName ?? "").toLowerCase();
  const text      = tweet.text?.replace(/@FUDmarkets/gi, "").trim() ?? "";
  // Use id_str to avoid JS float64 precision loss on 19-digit Twitter snowflake IDs
  const tweetId   = tweet._safeId ?? tweet.id_str ?? String(tweet.id);
  console.log(`[x-agent] Tweet raw id=${tweet.id} id_str=${tweet.id_str} _safeId=${tweet._safeId} → using ${tweetId}`);
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
    ? `\nLinked FUD account: "${fudUser.username}" (real: $${fudUser.balance_usd}, paper: $${fudUser.paper_balance_usd})`
    : `\nNo linked FUD account.`;

  // Fetch market context (top 5 open markets for context)
  let marketContext = "";
  try {
    const markets = await fetch(`${API}/markets`).then(r => r.json()) as any[];
    if (markets.length > 0) {
      const top = markets.slice(0, 5).map((m: any) => `${m.symbol} ${m.timeframe} L:$${m.long_pool} S:$${m.short_pool}`).join(", ");
      marketContext = `\nActive markets: ${top}`;
    }
  } catch {}

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Tweet from @${xUsername}: "${text}"${userContext}${marketContext}` },
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
  console.log(`  → Reply: ${reply}`);

  // ── Send to admin Telegram for approval ──
  const callbackId = `x_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const replies = [reply];

  const notif = `*X mention from @${xUsername}*\n\n_"${text}"_\n\n${reply}\n\n[View tweet](${tweetUrl})`;

  const keyboard = [
    [
      { text: "✅ Post",    callback_data: `xpost_${callbackId}_0` },
      { text: "✏️ Edit",   callback_data: `xedit_${callbackId}` },
      { text: "❌ Reject", callback_data: `xreject_${callbackId}` },
    ],
  ];

  const msgIds = await sendToAdminTelegram(notif, keyboard);

  // Auto-expire after 30 minutes
  const timeout = setTimeout(async () => {
    if (pending.has(callbackId)) {
      const e = pending.get(callbackId)!;
      pending.delete(callbackId);
      console.log(`[x-agent] Auto-expired reply to @${xUsername}`);
      await editAdminMessages(e.msgIds, `⏱ *Expired* (30min) — @${xUsername}`);
    }
  }, 30 * 60 * 1000);

  pending.set(callbackId, { tweetId, xUsername, replies, timeout, msgIds });
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const now = Math.floor(Date.now() / 1000);
    // Rolling 10-minute window — handles API indexing delays (new tweets can take 2-5min to appear)
    // processedIds Set handles deduplication across polls
    const sinceTime = now - 600;
    const url = `https://api.twitterapi.io/twitter/user/mentions?userName=${FUDMARKETS_USERNAME}&sinceTime=${sinceTime}`;
    console.log(`[x-agent] polling mentions: sinceTime=${sinceTime}`);
    const res  = await fetch(url, { headers: { "X-API-Key": TWITTERAPI_KEY } });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[x-agent] Poll HTTP ${res.status}: ${body}`);
      return;
    }
    const data = await res.json() as any;
    const mentions: any[] = data.tweets ?? [];
    console.log(`[x-agent] ${new Date().toISOString()} — ${mentions.length} mention(s) | raw keys: ${Object.keys(data).join(",")} | status: ${data.status}`);
    if (mentions.length === 0 && data.status !== "success") console.log(`[x-agent] raw response: ${JSON.stringify(data).slice(0, 300)}`);

    // Skip own tweets and already-processed IDs (processedIds handles dedup across polls)
    // Use id_str to avoid JS float64 precision loss on 19-digit Twitter snowflake IDs
    const toProcess = mentions.filter((t: any) => {
      const author = (t.author?.userName ?? t.user?.screen_name ?? "").toLowerCase();
      if (author === FUDMARKETS_USERNAME.toLowerCase()) return false;
      const tid = t.id_str ?? String(t.id);
      t._safeId = tid; // cache so processMention doesn't re-derive
      if (processedIds.has(tid)) return false;
      processedIds.add(tid);
      return true;
    });
    if (processedIds.size > 500) {
      const arr = [...processedIds];
      arr.slice(0, arr.length - 500).forEach(id => processedIds.delete(id));
    }
    if (!toProcess.length) return;
    console.log(`[x-agent] ${toProcess.length} new mention(s) to process`);
    for (const tweet of [...toProcess].reverse()) await processMention(tweet);
  } catch (e: any) {
    console.error(`[x-agent] Poll error: ${e.message}`);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function startXAgent() {
  if (!TWITTERAPI_KEY) { console.log("[x-agent] TWITTERAPI_KEY not set — skipping"); return; }
  console.log("[x-agent] Starting — monitoring @FUDmarkets");
  await loadLastPollTime();
  await poll();
  setInterval(poll, 60_000);
}
