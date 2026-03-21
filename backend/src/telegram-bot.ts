import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { db } from "./db/client.js";
import { createHmac, randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const API = process.env.BACKEND_URL || "http://localhost:3001";
const BOT_TOKEN = process.env.BOT_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "https://fud-markets.vercel.app";

// Chain map: dexscreener chainId → our backend chain label
const CHAIN_MAP: Record<string, string> = {
  solana:   "SOL",
  base:     "BASE",
  ethereum: "ETH",
  bsc:      "BSC",
};

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h"];

// In-memory sessions: tgId → { token, userId, username }
const sessions = new Map<number, { token: string; userId: string; username: string }>();

// Users waiting to pick a username on first registration
const pendingRegistration = new Set<number>();

// Pending custom bet on existing market: tgId → { marketId, side }
const pendingMarketBets = new Map<number, { marketId: string; side: string }>();

// Pending trade state: tgId → token info waiting for mode/TF/side/amount selection
interface PendingTrade {
  symbol: string;
  chain: string;   // SOL / BASE / ETH / BSC
  ca: string;
  price: number;
  liquidity: number;
  volume24h: number;
  marketCap: number;
  name: string;
  mode?: "real" | "paper";
  timeframe?: string;
  side?: string;
  amount?: number;
  awaitingMsg?: boolean; // waiting for user to type a tagline or skip
  flowMsgId?: number;    // message_id of the flow card (to edit after typing)
  groupChatId?: number;  // if search came from a group, post card there after opening
}
const pendingTrades = new Map<number, PendingTrade>();

// Per-user bet presets: tgId → [amt1, amt2, amt3, amt4]
const userPresets = new Map<number, number[]>();
const DEFAULT_PRESETS = [5, 25, 100, 500];
function getPresets(tgId: number): number[] {
  return userPresets.get(tgId) ?? DEFAULT_PRESETS;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function mintToken(userId: string, username: string): string {
  const secret  = process.env.JWT_SECRET!;
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ userId, username })).toString("base64url");
  const sig     = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

interface TgFrom { id: number; username?: string; first_name: string }

/** Returns session if account exists, null if user needs to register first */
async function getSession(tgId: number): Promise<{ token: string; userId: string; username: string } | null> {
  if (sessions.has(tgId)) return sessions.get(tgId)!;
  const { rows: [existing] } = await db.query(
    `SELECT id, username FROM users WHERE telegram_id = $1`, [tgId]
  );
  if (!existing) return null;
  const token = mintToken(existing.id, existing.username);
  const session = { token, userId: existing.id, username: existing.username };
  sessions.set(tgId, session);
  return session;
}

/** Create account with chosen username, returns error string or null on success */
async function registerUser(tgId: number, username: string): Promise<{ session: { token: string; userId: string; username: string } } | { error: string }> {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return { error: "Invalid username. Only letters, numbers and _ (3-20 chars)." };
  }
  const { rows: [taken] } = await db.query(`SELECT 1 FROM users WHERE username = $1`, [username.toLowerCase()]);
  if (taken) return { error: `❌ "${username}" is already taken. Try another.` };

  const { rows: [newUser] } = await db.query(
    `INSERT INTO users (username, telegram_id, paper_balance_usd)
     VALUES ($1, $2, 1000) RETURNING id, username`,
    [username.toLowerCase(), tgId]
  );
  const token = mintToken(newUser.id, newUser.username);
  const session = { token, userId: newUser.id, username: newUser.username };
  sessions.set(tgId, session);
  return { session };
}

// Place a bet via API (linked accounts with token) or direct DB (linked without token)
async function placeBet(session: any, marketId: string, side: string, amount: number) {
  if (session.token) {
    return apiFetch(`/markets/${marketId}/bet`, {
      method: "POST",
      body: JSON.stringify({ side, amount }),
      headers: { Authorization: `Bearer ${session.token}` },
    });
  }
  // Direct DB for linked accounts
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: [market] } = await client.query(
      `SELECT * FROM markets WHERE id = $1 AND status = 'open' FOR UPDATE`, [marketId]
    );
    if (!market) throw new Error("Market closed");
    const balCol = market.is_paper ? "paper_balance_usd" : "balance_usd";
    const { rows: [u] } = await client.query(
      `UPDATE users SET ${balCol} = ${balCol} - $1 WHERE id = $2 AND ${balCol} >= $1 RETURNING balance_usd, paper_balance_usd`,
      [amount, session.userId]
    );
    if (!u) throw new Error("Insufficient balance");
    const poolCol = side === "long" ? "long_pool" : "short_pool";
    await client.query(`UPDATE markets SET ${poolCol} = ${poolCol} + $1 WHERE id = $2`, [amount, marketId]);
    await client.query(
      `INSERT INTO positions (user_id, market_id, side, amount, is_paper) VALUES ($1, $2, $3, $4, $5)`,
      [session.userId, marketId, side, amount, market.is_paper]
    );
    await client.query("COMMIT");
    return { new_balance: u.balance_usd, new_paper_balance: u.paper_balance_usd };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function formatPrice(n: number): string {
  if (n >= 1) return n.toFixed(4);
  const s = n.toFixed(12).replace(/0+$/, "");
  const match = s.match(/^0\.(0+)/);
  if (match) {
    const zeros = match[1].length;
    if (zeros >= 4) return `0.0{${zeros}}${s.slice(2 + zeros, 2 + zeros + 4)}`;
  }
  return n.toPrecision(4);
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ─── AI Agent ─────────────────────────────────────────────────────────────────

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Conversation history per user (last 20 turns)
const chatHistory = new Map<number, Anthropic.MessageParam[]>();

function pushHistory(tgId: number, role: "user" | "assistant", content: string) {
  const h = chatHistory.get(tgId) ?? [];
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
  chatHistory.set(tgId, h);
}

const AI_SYSTEM = `You are FUD — the mascot of FUD.markets, a prediction markets platform where people bet LONG or SHORT on crypto prices.

PERSONALITY:
- Casual, sharp, and a bit sarcastic. You know your stuff but you don't try too hard.
- Short answers. You're on Telegram, not writing an essay.
- You can be funny, but naturally — no forced slang. Talk like a normal person who's deep into crypto.
- Understands Spanish — switch to it if the user writes in Spanish.
- Never give financial advice, but you can have opinions on market vibes.

PLATFORM:
- Users open prediction markets on any token and bet LONG or SHORT
- Timeframes: 1m, 5m, 15m, 1h, 4h, 24h
- Real money (USDC) or paper trading
- To trade: just type a symbol or paste a contract address
- /markets — open markets, /me — your balance

IMPORTANT — TOKEN LOOKUPS:
Whenever the user mentions a crypto token by name or ticker (e.g. "pepe", "doge", "what about wif", "wen pump bonk"), ALWAYS call the search_token tool first to get live price data before responding. Use the ticker or name as the query. Don't make up prices.

Keep replies to 1-3 sentences. Be real, not performative.`;

async function getAIReply(
  tgId: number,
  userMessage: string,
  session: { token: string; userId: string; username: string } | null,
): Promise<string> {
  if (!anthropic) return "gm ser 🫡 (ANTHROPIC_API_KEY not configured)";

  pushHistory(tgId, "user", userMessage);

  const tools: Anthropic.Tool[] = [
    {
      name: "get_open_markets",
      description: "Fetch the currently open prediction markets on FUD.markets",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "search_token",
      description: "Search for a crypto token by symbol or contract address to get its price, market cap, and liquidity",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Token symbol (e.g. PEPE) or contract address" },
        },
        required: ["query"],
      },
    },
  ];

  if (session) {
    tools.push({
      name: "get_user_balance",
      description: "Get the current user's real USDC balance and paper balance",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    });
  }

  const messages: Anthropic.MessageParam[] = chatHistory.get(tgId) ?? [];

  // Agentic loop: keep going while Claude wants to use tools
  let currentMessages = [...messages];
  for (let turn = 0; turn < 5; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: AI_SYSTEM,
      tools,
      messages: currentMessages,
    });

    if (response.stop_reason !== "tool_use") {
      const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "gm ser 🫡";
      pushHistory(tgId, "assistant", text);
      return text;
    }

    // Execute all requested tools
    const assistantMsg: Anthropic.MessageParam = { role: "assistant", content: response.content };
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      let result = "";
      try {
        if (block.name === "get_open_markets") {
          const markets = await apiFetch("/markets");
          const open = (markets as any[]).filter((m) => m.status === "open").slice(0, 6);
          result = open.length === 0
            ? "No open markets right now."
            : open.map((m) => `• ${m.symbol} ${m.timeframe} ${m.is_paper ? "📄" : "💵"} — pool $${(parseFloat(m.long_pool) + parseFloat(m.short_pool)).toFixed(0)}`).join("\n");
        } else if (block.name === "search_token") {
          const q = (block.input as any).query as string;
          const token = await searchToken(q);
          result = token
            ? `${token.symbol} on ${token.chain} | price $${formatPrice(token.price)} | mcap ${token.marketCap > 0 ? formatNum(token.marketCap) : "?"} | liq ${formatNum(token.liquidity)}`
            : `Token "${q}" not found on DexScreener.`;
        } else if (block.name === "get_user_balance" && session) {
          const { rows: [u] } = await db.query(
            `SELECT balance_usd, paper_balance_usd FROM users WHERE id = $1`, [session.userId]
          );
          result = `Real: $${parseFloat(u.balance_usd).toFixed(2)} | Paper: $${parseFloat(u.paper_balance_usd).toFixed(2)}`;
        }
      } catch (e: any) {
        result = `Error: ${e.message}`;
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    currentMessages = [...currentMessages, assistantMsg, { role: "user", content: toolResults }];
  }

  return "ngmi ser, something broke 😅";
}

async function searchToken(query: string): Promise<PendingTrade | null> {
  const isCA = query.length > 20 && !/\s/.test(query);
  const url = isCA
    ? `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(query.trim())}`
    : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query.trim())}`;

  console.log(`[bot] DexScreener fetch: ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "FUDmarkets/1.0" } });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const data = await res.json() as any;
  let pairs: any[] = data.pairs ?? [];
  console.log(`[bot] Pairs found: ${pairs.length}`);
  if (pairs.length === 0) return null;

  // If CA search, filter to exact address match to avoid cross-chain confusion
  if (isCA) {
    const addr = query.trim().toLowerCase();
    const exact = pairs.filter((p: any) => p.baseToken?.address?.toLowerCase() === addr);
    if (exact.length > 0) pairs = exact;
  }

  const withPrice = pairs.filter((p: any) => p.priceUsd && parseFloat(p.priceUsd) > 0);
  if (withPrice.length === 0) return null;

  // Pick best pair: highest liquidity
  const best = withPrice.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const chain = CHAIN_MAP[best.chainId] ?? best.chainId.toUpperCase();

  return {
    symbol:    best.baseToken.symbol,
    chain,
    ca:        best.baseToken.address,
    price:     parseFloat(best.priceUsd),
    liquidity: best.liquidity?.usd ?? 0,
    volume24h: best.volume?.h24 ?? 0,
    marketCap: best.marketCap ?? best.fdv ?? 0,
    name:      best.baseToken.name,
  };
}

function groupTokenMessage(t: PendingTrade): string {
  return (
    `🪙 *${t.symbol}* — ${t.name}\n` +
    `⛓ Chain: ${t.chain}\n` +
    `💰 Price: $${formatPrice(t.price)}\n` +
    `📈 MCap: ${t.marketCap > 0 ? formatNum(t.marketCap) : "—"}\n` +
    `💧 Liq: ${formatNum(t.liquidity)}\n` +
    `📊 Vol 24h: ${formatNum(t.volume24h)}`
  );
}

function tokenMessage(t: PendingTrade): string {
  const base =
    `🪙 *${t.symbol}* — ${t.name}\n` +
    `⛓ Chain: ${t.chain}\n` +
    `💰 Price: $${formatPrice(t.price)}\n` +
    `📈 MCap: ${t.marketCap > 0 ? formatNum(t.marketCap) : "—"}\n` +
    `💧 Liq: ${formatNum(t.liquidity)}\n` +
    `📊 Vol 24h: ${formatNum(t.volume24h)}`;

  if (!t.mode)      return base + "\n\nReal money or Paper?";
  const modeLabel   = t.mode === "real" ? "💵 Real" : "📄 Paper";
  if (!t.timeframe) return base + `\n\n${modeLabel} — Pick a timeframe:`;
  const sideLabel   = t.side === "long" ? "📈 Long" : "📉 Short";
  if (!t.side)      return base + `\n\n${modeLabel} · ⏱ ${t.timeframe} — Long or Short?`;
  return base + `\n\n${modeLabel} · ⏱ ${t.timeframe} · ${sideLabel} — How much?`;
}

function marketCard(m: any): string {
  const longPool  = parseFloat(m.long_pool);
  const shortPool = parseFloat(m.short_pool);
  const total     = longPool + shortPool;
  const longPct   = total > 0 ? Math.round(longPool  / total * 100) : 50;
  const shortPct  = 100 - longPct;
  const closes    = new Date(m.closes_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const longMult  = longPool  > 0 ? (1 + shortPool * 0.95 / longPool).toFixed(2)  + "x" : "—";
  const shortMult = shortPool > 0 ? (1 + longPool  * 0.95 / shortPool).toFixed(2) + "x" : "—";
  return (
    `🔥 *${m.symbol}* · ${m.timeframe} · ${m.chain} · 📄 Paper\n` +
    `💰 Entry: $${formatPrice(parseFloat(m.entry_price))}\n` +
    `⏰ Closes: ${closes}\n\n` +
    `🏊 Total pool: $${total.toFixed(0)}\n` +
    `  📈 Long: $${longPool.toFixed(0)} (${longPct}%) → ${longMult}\n` +
    `  📉 Short: $${shortPool.toFixed(0)} (${shortPct}%) → ${shortMult}`
  );
}

function marketSideKeyboard(marketId: string) {
  return Markup.inlineKeyboard([[
    Markup.button.callback("📈 LONG", `marketside:${marketId}:long`),
    Markup.button.callback("📉 SHORT", `marketside:${marketId}:short`),
  ]]);
}

function marketAmtKeyboard(marketId: string, side: string, tgId: number) {
  const presets = getPresets(tgId);
  return Markup.inlineKeyboard([
    presets.map(a => Markup.button.callback(`$${a}`, `marketamt:${marketId}:${side}:${a}`)),
    [
      Markup.button.callback("✏️ Custom", `marketcustom:${marketId}:${side}`),
      Markup.button.callback("↩️ Back", `marketback:${marketId}`),
    ],
  ]);
}

function modeKeyboard(tgId: number) {
  return Markup.inlineKeyboard([[
    Markup.button.callback("💵 Real",  `mode:${tgId}:real`),
    Markup.button.callback("📄 Paper", `mode:${tgId}:paper`),
  ]]);
}

function tfKeyboard(tgId: number) {
  return Markup.inlineKeyboard([
    TIMEFRAMES.map(tf => Markup.button.callback(tf, `tf:${tgId}:${tf}`)),
    [Markup.button.callback("↩️ Mode", `changemode:${tgId}`)],
  ]);
}

function sideKeyboard(tgId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📈 LONG",  `side:${tgId}:long`),
      Markup.button.callback("📉 SHORT", `side:${tgId}:short`),
    ],
    [Markup.button.callback("↩️ Change TF", `changetf:${tgId}`)],
  ]);
}

function amtKeyboard(tgId: number) {
  const presets = getPresets(tgId);
  return Markup.inlineKeyboard([
    presets.map(a => Markup.button.callback(`$${a}`, `amt:${tgId}:${a}`)),
    [
      Markup.button.callback("✏️ Custom", `amtcustom:${tgId}`),
      Markup.button.callback("↩️ Change side", `changeside:${tgId}`),
    ],
  ]);
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

export async function startBot() {
  console.log("[bot] startBot() called — BOT_TOKEN present:", !!BOT_TOKEN);
  if (!BOT_TOKEN) {
    console.warn("⚠️  BOT_TOKEN not set — Telegram bot disabled");
    return;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // Bot username (fetched once at startup for deep links)
  let botUsername = "FUDmarkets_BOT";
  bot.telegram.getMe().then(me => { botUsername = me.username ?? botUsername; }).catch(() => {});

  // DEBUG: log every update
  bot.use((ctx, next) => {
    const type = (ctx.update as any).message?.text ? "text" : Object.keys(ctx.update)[1] ?? "?";
    const text = (ctx.update as any).message?.text ?? "";
    console.log(`[bot:update] type=${type} text="${text.slice(0, 40)}"`);
    return next();
  });

  // /start
  bot.start(async (ctx) => {
    const payload = (ctx as any).startPayload as string | undefined;

    // Frontend-initiated link: start=link_{token}
    if (payload?.startsWith("link_")) {
      const linkToken = payload.slice("link_".length);
      const { rows: [entry] } = await db.query(
        `DELETE FROM tg_link_tokens WHERE token = $1 AND expires_at > NOW() AND user_id IS NOT NULL RETURNING user_id`,
        [linkToken]
      ).catch(() => ({ rows: [] }));
      if (!entry) {
        return ctx.reply("❌ Link expired or invalid. Try again from the app.");
      }
      await db.query(`UPDATE users SET telegram_id = NULL WHERE telegram_id = $1 AND id != $2`, [ctx.from.id, entry.user_id]);
      await db.query(`UPDATE users SET telegram_id = $1 WHERE id = $2`, [ctx.from.id, entry.user_id]);
      sessions.delete(ctx.from.id);
      const { rows: [user] } = await db.query(`SELECT username FROM users WHERE id = $1`, [entry.user_id]);
      return ctx.reply(`✅ Telegram connected to *${user?.username ?? "your account"}*!\n\nYou can now trade directly from here.`, { parse_mode: "Markdown" });
    }

    // Accept Challenge deep link: start=challenge_{marketId}
    if (payload?.startsWith("challenge_")) {
      const marketId = payload.slice("challenge_".length);
      const { rows: [market] } = await db.query(`SELECT * FROM markets WHERE id = $1`, [marketId]).catch(() => ({ rows: [] }));
      if (market) {
        return ctx.reply(marketCard(market), { parse_mode: "Markdown", ...marketSideKeyboard(marketId) });
      }
    }

    const session = await getSession(ctx.from.id);
    if (session) {
      // If there's a pending trade from a group, jump straight into the flow
      const pending = pendingTrades.get(ctx.from.id);
      if (pending && !pending.mode) {
        return ctx.reply(tokenMessage(pending), { parse_mode: "Markdown", ...modeKeyboard(ctx.from.id) });
      }
      await ctx.reply(
        `👋 Welcome back, *${session.username}*!\n\n` +
          `Drop a CA or symbol to open a market\n` +
          `/search <SYMBOL or CA>\n` +
          `/markets — open markets\n` +
          `/me — your balance`,
        { parse_mode: "Markdown" }
      );
    } else {
      // Generate a one-time link token (expires in 10 min), stored in DB
      const token = randomBytes(16).toString("hex");
      try {
        console.log(`[bot:/start] Inserting tg_link token for tgId=${ctx.from.id}, token=${token.slice(0, 8)}…`);
        await db.query(
          `INSERT INTO tg_link_tokens (token, tg_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (token) DO UPDATE SET tg_id = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [token, ctx.from.id]
        );
        console.log(`[bot:/start] Token inserted OK`);
      } catch (e: any) {
        console.error(`[bot:/start] DB insert failed:`, e.message);
        return ctx.reply("Internal error — please try again in a moment.");
      }

      const linkUrl = `${FRONTEND_URL}?tg_link=${token}`;
      await ctx.reply(
        `👋 *FUD\\.markets*\n\n` +
          `Your Telegram is not linked to any account\\.\n\n` +
          `Tap the button below to register or sign in and connect automatically\\.`,
        {
          parse_mode: "MarkdownV2",
          ...Markup.inlineKeyboard([[
            Markup.button.url("🌐 Register / Sign up", linkUrl),
          ]]),
        }
      );
    }
  });

  // /search <query>
  bot.command("search", async (ctx) => {
    const query = ctx.message.text.replace(/^\/search\s*/i, "").trim();
    if (!query) return ctx.reply("Usage: /search <SYMBOL> or paste a CA\nExample: /search PEPE");

    const isGroup = ctx.chat.type !== "private";
    const msg = await ctx.reply("🔍 Searching…");
    let token: PendingTrade | null;
    try {
      token = await searchToken(query);
    } catch {
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
      return ctx.reply("❌ Error searching for token.");
    }
    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});

    if (!token) return ctx.reply(`❌ "${query}" not found. Try pasting the contract address.`);

    if (isGroup) {
      // Store group chatId so the market card gets posted back here after opening
      token.groupChatId = ctx.chat.id;
      pendingTrades.set(ctx.from.id, token);
      // Post token card in group with "Open Trade" deep-link button
      const deepLink = `https://t.me/${botUsername}?start=opentrade`;
      await ctx.reply(groupTokenMessage(token), {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[Markup.button.url("🔥 Open Trade", deepLink)]]),
      });
    } else {
      pendingTrades.set(ctx.from.id, token);
      await ctx.reply(tokenMessage(token), { parse_mode: "Markdown", ...modeKeyboard(ctx.from.id) });
    }
  });

  // Any text message that looks like a CA or short symbol (auto-detect)
  bot.on(message("text"), async (ctx, next) => {
    const text = ctx.message.text.trim();

    // Let command handlers deal with commands
    if (text.startsWith("/")) return next();

    // In groups: respond to CAs (token search) or @mentions (AI)
    if (ctx.chat.type !== "private") {
      const isCA = text.length > 20 && !/\s/.test(text);

      // CA pasted → search token and post card
      if (isCA) {
        const searching = await ctx.reply("🔍 Searching…");
        try {
          const found = await searchToken(text);
          await ctx.telegram.deleteMessage(ctx.chat.id, searching.message_id).catch(() => {});
          if (!found) return ctx.reply(`❌ Token not found for that CA.`);
          found.groupChatId = ctx.chat.id;
          pendingTrades.set(ctx.from.id, found);
          const deepLink = `https://t.me/${botUsername}?start=opentrade`;
          await ctx.reply(groupTokenMessage(found), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.url("🔥 Open Trade", deepLink)]]),
          });
        } catch {
          await ctx.telegram.deleteMessage(ctx.chat.id, searching.message_id).catch(() => {});
          await ctx.reply("❌ Error searching token.");
        }
        return;
      }

      // @mention → strip mention and reply with AI
      const mentionRegex = new RegExp(`@${botUsername}\\b`, "i");
      const isMentioned = mentionRegex.test(text)
        || (ctx.message as any).reply_to_message?.from?.username?.toLowerCase() === botUsername.toLowerCase();

      if (!isMentioned) return;

      const cleanText = text.replace(mentionRegex, "").trim() || "gm";
      if (!anthropic) return ctx.reply("gm ser 🫡");
      try {
        const session = await getSession(ctx.from.id).catch(() => null);
        const reply = await getAIReply(ctx.from.id, cleanText, session);
        await ctx.reply(reply, { parse_mode: "Markdown" });
      } catch (e: any) {
        console.error("[bot] AI group error:", e.message);
      }
      return;
    }

    // Require account for trading
    const session = await getSession(ctx.from.id);
    if (!session) {
      return ctx.reply(
        `🔗 *Link your Telegram first\\!*\n\nCreate your account at [fud\\.markets](${FRONTEND_URL}) or use /start to register here\\.`,
        { parse_mode: "MarkdownV2" }
      );
    }

    // Custom amount for existing market bet
    const pendingMarket = pendingMarketBets.get(ctx.from.id);
    if (pendingMarket) {
      const amount = parseFloat(text.replace(",", "."));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("❌ Invalid amount. Enter a number, e.g. 37.5");
      }
      pendingMarketBets.delete(ctx.from.id);
      const emoji = pendingMarket.side === "long" ? "📈" : "📉";
      let betData: any;
      try {
        betData = await placeBet(session, pendingMarket.marketId, pendingMarket.side, amount);
      } catch (e: any) {
        return ctx.reply(`❌ ${e.message}`);
      }
      const paperBal = parseFloat(String(betData.new_paper_balance)).toFixed(2);
      await ctx.reply(`${emoji} *${pendingMarket.side.toUpperCase()} $${amount}* placed! Paper: $${paperBal}`, { parse_mode: "Markdown" });
      return;
    }

    // Custom amount for new market flow (amount === -1 means waiting for custom input)
    const pendingForCustomAmt = pendingTrades.get(ctx.from.id);
    if (pendingForCustomAmt?.amount === -1 && pendingForCustomAmt.side && !pendingForCustomAmt.awaitingMsg) {
      const amount = parseFloat(text.replace(",", "."));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("❌ Invalid amount. Enter a number, e.g. 37.5");
      }
      pendingForCustomAmt.amount = amount;
      pendingForCustomAmt.awaitingMsg = true;
      pendingTrades.set(ctx.from.id, pendingForCustomAmt);
      await ctx.reply(
        tokenMessage(pendingForCustomAmt) + `\n\n💬 *Say something!*`,
        { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("⏭ Skip", `skipmsg:${ctx.from.id}`)]]) }
      );
      return;
    }

    // If user is writing a message/challenge for a pending trade, capture it
    const pendingForMsg = pendingTrades.get(ctx.from.id);
    if (pendingForMsg?.awaitingMsg) {
      pendingForMsg.awaitingMsg = false;
      pendingTrades.set(ctx.from.id, pendingForMsg);
      await executeBet(ctx, ctx.from.id, text);
      return;
    }

    // Detect CA (>20 chars, no spaces) or token symbol (all-uppercase, 2–10 chars, e.g. PEPE BTC WIF)
    const isCA     = text.length > 20 && !/\s/.test(text);
    const isSymbol = /^[A-Z0-9]{2,10}$/.test(text);

    if (isCA || isSymbol) {
      console.log(`[bot] Searching token: "${text}" (isCA=${isCA})`);
      const msg = await ctx.reply("🔍 Searching…");
      try {
        const token = await searchToken(text);
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
        if (!token) {
          return ctx.reply(`❌ "${text.slice(0, 20)}…" not found. Check the CA or symbol.`);
        }
        pendingTrades.set(ctx.from.id, token);
        await ctx.reply(tokenMessage(token), { parse_mode: "Markdown", ...modeKeyboard(ctx.from.id) });
      } catch (e: any) {
        console.error("[bot] searchToken error:", e.message);
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
        await ctx.reply(`❌ Error searching token: ${e.message}`);
      }
      return;
    }

    // Everything else → AI agent
    if (!anthropic) return;
    try {
      const reply = await getAIReply(ctx.from.id, text, session);
      await ctx.reply(reply, { parse_mode: "Markdown" });
    } catch (e: any) {
      console.error("[bot] AI error:", e.message);
    }
  });

  // Mode selected (Real / Paper)
  bot.action(/^mode:(\d+):(real|paper)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    const mode = ctx.match[2] as "real" | "paper";

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Session expired. Search the token again.");

    trade.mode = mode;
    trade.timeframe = undefined;
    trade.side = undefined;
    pendingTrades.set(tgId, trade);

    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...tfKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Change mode (back to Real/Paper selection)
  bot.action(/^changemode:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Session expired.");

    trade.mode = undefined;
    trade.timeframe = undefined;
    trade.side = undefined;
    pendingTrades.set(tgId, trade);
    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...modeKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Timeframe selected → show Long/Short buttons
  bot.action(/^tf:(\d+):(.+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    const tf   = ctx.match[2];

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Session expired. Search the token again.");

    trade.timeframe = tf;
    trade.side = undefined;
    pendingTrades.set(tgId, trade);

    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...sideKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Change TF (back to timeframe selection)
  bot.action(/^changetf:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Session expired.");

    trade.timeframe = undefined;
    trade.side = undefined;
    pendingTrades.set(tgId, trade);
    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...tfKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Side selected (Long / Short) → show amount buttons
  bot.action(/^side:(\d+):(long|short)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    const side = ctx.match[2];

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");

    const trade = pendingTrades.get(tgId);
    if (!trade || !trade.timeframe) return ctx.answerCbQuery("Session expired.");

    trade.side = side;
    pendingTrades.set(tgId, trade);

    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...amtKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Change side (back to Long/Short selection)
  bot.action(/^changeside:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Session expired.");

    trade.side = undefined;
    pendingTrades.set(tgId, trade);
    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...sideKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Amount selected → ask for optional message
  bot.action(/^amt:(\d+):(\d+)$/, async (ctx) => {
    const tgId   = parseInt(ctx.match[1]);
    const amount = parseFloat(ctx.match[2]);

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");

    const trade = pendingTrades.get(tgId);
    if (!trade || !trade.mode || !trade.timeframe || !trade.side) {
      return ctx.answerCbQuery("Session expired. Search the token again.");
    }

    trade.amount = amount;
    trade.awaitingMsg = true;
    pendingTrades.set(tgId, trade);

    await ctx.editMessageText(
      tokenMessage(trade) + `\n\n💬 *Say something!*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[Markup.button.callback("⏭ Skip", `skipmsg:${tgId}`)]]),
      }
    );
    trade.flowMsgId = ctx.callbackQuery.message?.message_id;
    pendingTrades.set(tgId, trade);
    await ctx.answerCbQuery();
  });

  // Skip message → place bet immediately
  bot.action(/^skipmsg:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");
    await ctx.answerCbQuery("⏳ Opening market…");
    await executeBet(ctx, tgId, "");
  });

  // Custom amount for new market flow
  bot.action(/^amtcustom:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("Not yours.");
    const trade = pendingTrades.get(tgId);
    if (!trade || !trade.side) return ctx.answerCbQuery("Session expired.");
    trade.awaitingMsg = false;
    trade.amount = -1; // flag: awaiting custom amount
    pendingTrades.set(tgId, trade);
    await ctx.answerCbQuery();
    await ctx.reply("✏️ Enter the amount to bet (e.g. 37.5):");
  });

  // ─── Helper: open market + place bet ─────────────────────────────────────────
  async function executeBet(ctx: any, tgId: number, tagline: string) {
    const trade = pendingTrades.get(tgId);
    if (!trade || !trade.mode || !trade.timeframe || !trade.side || !trade.amount) return;

    const session = await getSession(tgId);
    if (!session) {
      await ctx.reply("🔗 Link your Telegram first. Use /start.");
      return;
    }

    let market: any;
    try {
      market = await apiFetch("/markets", {
        method: "POST",
        body: JSON.stringify({
          symbol:    trade.symbol,
          chain:     trade.chain,
          timeframe: trade.timeframe,
          paper:     trade.mode === "paper",
          ca:        trade.ca,
          tagline:   tagline || "",
        }),
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch (e: any) {
      await ctx.reply(`❌ Error opening market: ${e.message}`);
      return;
    }

    let betResult: any;
    try {
      betResult = await placeBet(session, market.id, trade.side, trade.amount);
    } catch (e: any) {
      await ctx.reply(`✅ Market opened, but error placing bet: ${e.message}\nUse /markets to bet.`);
      return;
    }

    const emoji   = trade.side === "long" ? "📈" : "📉";
    const isPaper = trade.mode === "paper";
    const bal     = isPaper
      ? `🎭 Paper balance: $${parseFloat(betResult.new_paper_balance).toFixed(2)}`
      : `💵 Real balance: $${parseFloat(betResult.new_balance).toFixed(2)}`;

    const confirmation =
      `${emoji} *${trade.side.toUpperCase()} $${trade.amount}* on *${trade.symbol}* · ${trade.timeframe} · ${isPaper ? "📄 Paper" : "💵 Real"}\n` +
      `💰 Entry: $${formatPrice(parseFloat(market.entry_price))}\n${bal}`;

    pendingTrades.delete(tgId);

    // Edit the flow card if possible, else send new message
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (trade.flowMsgId && chatId) {
      await ctx.telegram.editMessageText(chatId, trade.flowMsgId, undefined, confirmation, { parse_mode: "Markdown" }).catch(() => {});
    } else {
      await ctx.reply(confirmation, { parse_mode: "Markdown" });
    }

    // Post challenge card to group (or DM if no group)
    const targetChatId = trade.groupChatId ?? chatId;
    if (targetChatId) {
      const quote    = tagline.trim() || "Let's ride! 🔥";
      const sideText = trade.side === "long" ? "LONG 📈" : "SHORT 📉";
      const modeText = isPaper ? "Paper" : "Real";
      const challengeText =
        `"${quote}"\n\n` +
        `@${session.username} opened a *${sideText}* position for *$${trade.amount}*\n` +
        `🪙 *${trade.symbol}* · ${trade.timeframe} · ${modeText}\n` +
        `💰 Entry: $${formatPrice(parseFloat(market.entry_price))}`;

      const deepLink   = `https://t.me/${botUsername}?start=challenge_${market.id}`;
      const chainSlug  = ({ SOL: "solana", BASE: "base", ETH: "ethereum", BSC: "bsc" } as Record<string, string>)[trade.chain] ?? trade.chain.toLowerCase();
      const chartUrl   = `https://dexscreener.com/${chainSlug}/${trade.ca}`;
      await ctx.telegram.sendMessage(targetChatId, challengeText, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[
          Markup.button.url("⚔️ Take the other side", deepLink),
          Markup.button.url("📊 Chart", chartUrl),
        ]]),
      });
    }
  }

  // /markets — list open markets with bet buttons
  bot.command("markets", async (ctx) => {
    const markets: any[] = await apiFetch("/markets").catch(() => []);
    const open = markets.filter((m: any) => m.status === "open");
    if (open.length === 0) return ctx.reply("No open markets right now.");

    for (const m of open.slice(0, 5)) {
      await ctx.reply(marketCard(m), {
        parse_mode: "Markdown",
        ...marketSideKeyboard(m.id),
      });
    }
  });

  // Step 1: Side selected on existing market → show amount keyboard
  bot.action(/^marketside:(.+):(long|short)$/, async (ctx) => {
    const [, marketId, side] = ctx.match;
    const session = await getSession(ctx.from.id).catch(() => null);
    if (!session) return ctx.answerCbQuery(`🔗 Link your Telegram first! DM the bot and use /start.`, { show_alert: true });
    const { rows: [market] } = await db.query(`SELECT * FROM markets WHERE id = $1`, [marketId]);
    if (!market) return ctx.answerCbQuery("Market not found.", { show_alert: true });
    const emoji = side === "long" ? "📈" : "📉";
    await ctx.editMessageText(
      marketCard(market) + `\n\n${emoji} *${side.toUpperCase()}* — How much?`,
      { parse_mode: "Markdown", ...marketAmtKeyboard(marketId, side, ctx.from.id) }
    );
    await ctx.answerCbQuery();
  });

  // Step 2a: Amount selected → place bet
  bot.action(/^marketamt:(.+):(long|short):(\d+(?:\.\d+)?)$/, async (ctx) => {
    const [, marketId, side, amountStr] = ctx.match;
    const amount = parseFloat(amountStr);
    const emoji  = side === "long" ? "📈" : "📉";
    const session = await getSession(ctx.from.id).catch(() => null);
    if (!session) return ctx.answerCbQuery(`🔗 Link your Telegram first!`, { show_alert: true });
    let betData: any;
    try {
      betData = await placeBet(session, marketId, side, amount);
    } catch (e: any) {
      return ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true });
    }
    const paperBal = parseFloat(String(betData.new_paper_balance)).toFixed(2);
    await ctx.answerCbQuery(`${emoji} ${side.toUpperCase()} $${amount} placed! Paper: $${paperBal}`);
    const { rows: [market] } = await db.query(`SELECT * FROM markets WHERE id = $1`, [marketId]);
    if (market) await ctx.editMessageText(marketCard(market), { parse_mode: "Markdown", ...marketSideKeyboard(marketId) }).catch(() => {});
  });

  // Step 2b: Custom amount → ask user to type
  bot.action(/^marketcustom:(.+):(long|short)$/, async (ctx) => {
    const [, marketId, side] = ctx.match;
    pendingMarketBets.set(ctx.from.id, { marketId, side });
    const emoji = side === "long" ? "📈" : "📉";
    await ctx.answerCbQuery();
    await ctx.reply(`${emoji} *${side.toUpperCase()}* — Enter the amount to bet (e.g. 37.5):`, { parse_mode: "Markdown" });
  });

  // Back to side selection
  bot.action(/^marketback:(.+)$/, async (ctx) => {
    const [, marketId] = ctx.match;
    const { rows: [market] } = await db.query(`SELECT * FROM markets WHERE id = $1`, [marketId]);
    if (!market) return ctx.answerCbQuery("Market not found.", { show_alert: true });
    await ctx.editMessageText(marketCard(market), { parse_mode: "Markdown", ...marketSideKeyboard(marketId) });
    await ctx.answerCbQuery();
  });

  // /link <username> <password> — connect existing web account to this Telegram identity
  bot.command("link", async (ctx) => {
    ctx.deleteMessage().catch(() => {});
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 3) return ctx.reply("Usage: /link <username> <password>\nLinks your existing web account to this Telegram.");
    const [, username, password] = parts;

    let data: any;
    try {
      data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    } catch (e: any) {
      return ctx.reply(`❌ Login failed: ${e.message}`);
    }

    // Remove telegram_id from the auto-created account (if any), assign to web account
    await db.query(`UPDATE users SET telegram_id = NULL WHERE telegram_id = $1 AND id != $2`, [ctx.from.id, data.user.id]);
    await db.query(`UPDATE users SET telegram_id = $1 WHERE id = $2`, [ctx.from.id, data.user.id]);
    sessions.set(ctx.from.id, { token: data.token, userId: data.user.id, username: data.user.username });

    await ctx.reply(
      `✅ Web account *${data.user.username}* linked to this Telegram\n\n` +
        `💵 Real balance: $${parseFloat(data.user.balance_usd ?? 0).toFixed(2)}\n` +
        `🎭 Paper balance: $${parseFloat(data.user.paper_balance_usd ?? 0).toFixed(2)}`,
      { parse_mode: "Markdown" }
    );
  });

  // /unlink
  bot.command("unlink", async (ctx) => {
    const { rowCount } = await db.query(`UPDATE users SET telegram_id = NULL WHERE telegram_id = $1`, [ctx.from.id]);
    sessions.delete(ctx.from.id);
    await ctx.reply(rowCount && rowCount > 0
      ? "✅ Account unlinked."
      : "You had no linked account."
    );
  });

  // /me
  bot.command("me", async (ctx) => {
    console.log(`[/me] tgId=${ctx.from.id}`);
    const session = await getSession(ctx.from.id);
    console.log(`[/me] session=${session ? session.username : "null"}`);
    if (!session) {
      return ctx.reply("No account found. Use /start to register.");
    }
    const { rows: [user] } = await db.query(
      `SELECT username, balance_usd, paper_balance_usd FROM users WHERE id = $1`, [session.userId]
    );
    console.log(`[/me] user=${user ? user.username : "null"}`);
    if (!user) return ctx.reply("Account not found.");
    await ctx.reply(
      `👤 ${user.username}\n\n` +
        `💵 Real balance: $${parseFloat(user.balance_usd).toFixed(2)}\n` +
        `🎭 Paper balance: $${parseFloat(user.paper_balance_usd).toFixed(2)}`
    );
    console.log(`[/me] replied OK`);
  });

  // /settings — view or change bet presets
  bot.command("settings", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length === 0) {
      const presets = getPresets(ctx.from.id);
      return ctx.reply(
        `⚙️ *Your bet presets:* $${presets.join(" · $")}\n\n` +
        `To change them: /settings 5 25 100 500`
      , { parse_mode: "Markdown" });
    }
    const nums = parts.map(Number).filter(n => !isNaN(n) && n > 0);
    if (nums.length !== 4) {
      return ctx.reply("You need exactly 4 amounts. E.g. /settings 5 25 100 500");
    }
    userPresets.set(ctx.from.id, nums);
    await ctx.reply(`✅ Presets updated: $${nums.join(" · $")}`);
  });

  // Catch all unhandled bot errors so they don't crash the process
  bot.catch((err: any) => {
    if (err?.response?.error_code === 400 && err?.response?.description?.includes("query is too old")) return;
    console.error("[bot:error]", err?.message ?? err);
  });

  // Register commands so they appear in the / menu
  bot.telegram.setMyCommands([
    { command: "start",    description: "Register or view your account" },
    { command: "search",   description: "Search a token: /search PEPE" },
    { command: "markets",  description: "View currently open markets" },
    { command: "me",       description: "View your balance and username" },
    { command: "settings", description: "View/change presets: /settings 5 25 100 500" },
    { command: "link",     description: "Link your web account: /link username password" },
    { command: "unlink",   description: "Unlink your Telegram account" },
  ]).catch((e) => console.error("[bot] setMyCommands error:", e.message));

  // Clear any webhook that might be blocking long-polling
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  } catch (e) {
    console.warn("[bot] deleteWebhook failed (ignored):", e);
  }
  bot.launch().catch((e: any) => console.error("[bot] launch error:", e?.message ?? e));
  console.log("🤖 Telegram bot started");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
