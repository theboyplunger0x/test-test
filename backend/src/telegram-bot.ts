import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { db } from "./db/client.js";
import { createHmac, randomBytes } from "node:crypto";

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

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "12h", "24h"];

// In-memory sessions: tgId → { token, userId, username }
const sessions = new Map<number, { token: string; userId: string; username: string }>();

// Users waiting to pick a username on first registration
const pendingRegistration = new Set<number>();

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
    return { error: "Username inválido. Solo letras, números y _ (3-20 caracteres)." };
  }
  const { rows: [taken] } = await db.query(`SELECT 1 FROM users WHERE username = $1`, [username.toLowerCase()]);
  if (taken) return { error: `❌ "${username}" ya está en uso. Elegí otro.` };

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
    if (!market) throw new Error("Mercado cerrado");
    const balCol = market.is_paper ? "paper_balance_usd" : "balance_usd";
    const { rows: [u] } = await client.query(
      `UPDATE users SET ${balCol} = ${balCol} - $1 WHERE id = $2 AND ${balCol} >= $1 RETURNING balance_usd, paper_balance_usd`,
      [amount, session.userId]
    );
    if (!u) throw new Error("Balance insuficiente");
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
  console.log(`[bot] Pairs encontrados: ${pairs.length}`);
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

  if (!t.mode)      return base + "\n\n¿Real money o Paper?";
  const modeLabel   = t.mode === "real" ? "💵 Real" : "📄 Paper";
  if (!t.timeframe) return base + `\n\n${modeLabel} — Elegí el timeframe:`;
  const sideLabel   = t.side === "long" ? "📈 Long" : "📉 Short";
  if (!t.side)      return base + `\n\n${modeLabel} · ⏱ ${t.timeframe} — ¿Long o Short?`;
  return base + `\n\n${modeLabel} · ⏱ ${t.timeframe} · ${sideLabel} — ¿Cuánto apostás?`;
}

function marketCard(m: any): string {
  const longPool  = parseFloat(m.long_pool);
  const shortPool = parseFloat(m.short_pool);
  const total     = longPool + shortPool;
  const longPct   = total > 0 ? Math.round(longPool  / total * 100) : 50;
  const shortPct  = 100 - longPct;
  const closes    = new Date(m.closes_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const longMult  = longPool  > 0 ? (1 + shortPool * 0.95 / longPool).toFixed(2)  + "x" : "—";
  const shortMult = shortPool > 0 ? (1 + longPool  * 0.95 / shortPool).toFixed(2) + "x" : "—";
  return (
    `🔥 *${m.symbol}* · ${m.timeframe} · ${m.chain} · 📄 Paper\n` +
    `💰 Entry: $${formatPrice(parseFloat(m.entry_price))}\n` +
    `⏰ Cierra: ${closes}\n\n` +
    `🏊 Pool total: $${total.toFixed(0)}\n` +
    `  📈 Long: $${longPool.toFixed(0)} (${longPct}%) → ${longMult}\n` +
    `  📉 Short: $${shortPool.toFixed(0)} (${shortPct}%) → ${shortMult}`
  );
}

function marketKeyboard(marketId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📈 LONG  $10", `bet:${marketId}:long:10`),
      Markup.button.callback("📉 SHORT $10", `bet:${marketId}:short:10`),
    ],
    [
      Markup.button.callback("📈 LONG  $25", `bet:${marketId}:long:25`),
      Markup.button.callback("📉 SHORT $25", `bet:${marketId}:short:25`),
    ],
    [
      Markup.button.callback("📈 LONG  $50", `bet:${marketId}:long:50`),
      Markup.button.callback("📉 SHORT $50", `bet:${marketId}:short:50`),
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
    [Markup.button.callback("↩️ Modo", `changemode:${tgId}`)],
  ]);
}

function sideKeyboard(tgId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📈 LONG",  `side:${tgId}:long`),
      Markup.button.callback("📉 SHORT", `side:${tgId}:short`),
    ],
    [Markup.button.callback("↩️ Cambiar TF", `changetf:${tgId}`)],
  ]);
}

function amtKeyboard(tgId: number) {
  const presets = getPresets(tgId);
  return Markup.inlineKeyboard([
    presets.map(a => Markup.button.callback(`$${a}`, `amt:${tgId}:${a}`)),
    [Markup.button.callback("↩️ Cambiar lado", `changeside:${tgId}`)],
  ]);
}

// ─── Bot ──────────────────────────────────────────────────────────────────────

export function startBot() {
  if (!BOT_TOKEN) {
    console.warn("⚠️  BOT_TOKEN not set — Telegram bot disabled");
    return;
  }

  const bot = new Telegraf(BOT_TOKEN);

  // Bot username (fetched once at startup for deep links)
  let botUsername = "testingagent13223bot";
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

    // Accept Challenge deep link: start=challenge_{marketId}
    if (payload?.startsWith("challenge_")) {
      const marketId = payload.slice("challenge_".length);
      const { rows: [market] } = await db.query(`SELECT * FROM markets WHERE id = $1`, [marketId]).catch(() => ({ rows: [] }));
      if (market) {
        return ctx.reply(marketCard(market), { parse_mode: "Markdown", ...marketKeyboard(marketId) });
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
        return ctx.reply("Error interno — intenta de nuevo en un momento.");
      }

      const linkUrl = `${FRONTEND_URL}?tg_link=${token}`;
      await ctx.reply(
        `👋 *FUD\\.markets*\n\n` +
          `Tu Telegram no está vinculado a ninguna cuenta\\.\n\n` +
          `Tocá el botón para registrarte o iniciar sesión y conectar automáticamente\\.`,
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
    if (!query) return ctx.reply("Uso: /search <SYMBOL> o pegá un CA\nEjemplo: /search PEPE");

    const isGroup = ctx.chat.type !== "private";
    const msg = await ctx.reply("🔍 Buscando…");
    let token: PendingTrade | null;
    try {
      token = await searchToken(query);
    } catch {
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
      return ctx.reply("❌ Error buscando el token.");
    }
    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});

    if (!token) return ctx.reply(`❌ No se encontró "${query}". Probá pegando el contract address.`);

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

    // In groups, plain text is blocked by privacy mode — guide user to /search
    if (ctx.chat.type !== "private") {
      const isCA = text.length > 20 && !/\s/.test(text);
      if (!isCA) return;
      // In groups: search and post token card with Open Trade button
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

    // Require account for trading
    const session = await getSession(ctx.from.id);
    if (!session) {
      return ctx.reply(
        `🔗 *Link your Telegram first\\!*\n\nCreate your account at [fud\\.markets](${FRONTEND_URL}) or use /start to register here\\.`,
        { parse_mode: "MarkdownV2" }
      );
    }

    // If user is writing a message/challenge for a pending trade, capture it
    const pendingForMsg = pendingTrades.get(ctx.from.id);
    if (pendingForMsg?.awaitingMsg) {
      pendingForMsg.awaitingMsg = false;
      pendingTrades.set(ctx.from.id, pendingForMsg);
      await executeBet(ctx, ctx.from.id, text);
      return;
    }

    // Detect CA (>20 chars, no spaces) or short token symbol (2–10 uppercase chars)
    const isCA     = text.length > 20 && !/\s/.test(text);
    const isSymbol = /^[A-Za-z0-9]{2,10}$/.test(text);
    if (!isCA && !isSymbol) return;

    console.log(`[bot] Buscando token: "${text}" (isCA=${isCA})`);

    const msg = await ctx.reply("🔍 Buscando…");
    try {
      const token = await searchToken(text);
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});

      if (!token) {
        return ctx.reply(`❌ No se encontró "${text.slice(0, 20)}…". Verificá el CA o símbolo.`);
      }

      pendingTrades.set(ctx.from.id, token);
      await ctx.reply(tokenMessage(token), { parse_mode: "Markdown", ...modeKeyboard(ctx.from.id) });
    } catch (e: any) {
      console.error("[bot] searchToken error:", e.message);
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
      await ctx.reply(`❌ Error buscando el token: ${e.message}`);
    }
  });

  // Mode selected (Real / Paper)
  bot.action(/^mode:(\d+):(real|paper)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    const mode = ctx.match[2] as "real" | "paper";

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Sesión expirada. Buscá el token de nuevo.");

    trade.mode = mode;
    trade.timeframe = undefined;
    trade.side = undefined;
    pendingTrades.set(tgId, trade);

    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...tfKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Cambiar modo (back to Real/Paper selection)
  bot.action(/^changemode:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Sesión expirada.");

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

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Sesión expirada. Buscá el token de nuevo.");

    trade.timeframe = tf;
    trade.side = undefined;
    pendingTrades.set(tgId, trade);

    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...sideKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Cambiar TF (back to timeframe selection)
  bot.action(/^changetf:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Sesión expirada.");

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

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");

    const trade = pendingTrades.get(tgId);
    if (!trade || !trade.timeframe) return ctx.answerCbQuery("Sesión expirada.");

    trade.side = side;
    pendingTrades.set(tgId, trade);

    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...amtKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Cambiar lado (back to Long/Short selection)
  bot.action(/^changeside:(\d+)$/, async (ctx) => {
    const tgId = parseInt(ctx.match[1]);
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");

    const trade = pendingTrades.get(tgId);
    if (!trade) return ctx.answerCbQuery("Sesión expirada.");

    trade.side = undefined;
    pendingTrades.set(tgId, trade);
    await ctx.editMessageText(tokenMessage(trade), { parse_mode: "Markdown", ...sideKeyboard(tgId) });
    await ctx.answerCbQuery();
  });

  // Amount selected → ask for optional message
  bot.action(/^amt:(\d+):(\d+)$/, async (ctx) => {
    const tgId   = parseInt(ctx.match[1]);
    const amount = parseFloat(ctx.match[2]);

    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");

    const trade = pendingTrades.get(tgId);
    if (!trade || !trade.mode || !trade.timeframe || !trade.side) {
      return ctx.answerCbQuery("Sesión expirada. Buscá el token de nuevo.");
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
    if (tgId !== ctx.from.id) return ctx.answerCbQuery("No es tuyo.");
    await ctx.answerCbQuery("⏳ Abriendo mercado…");
    await executeBet(ctx, tgId, "");
  });

  // ─── Helper: open market + place bet ─────────────────────────────────────────
  async function executeBet(ctx: any, tgId: number, tagline: string) {
    const trade = pendingTrades.get(tgId);
    if (!trade || !trade.mode || !trade.timeframe || !trade.side || !trade.amount) return;

    const session = await getSession(tgId);
    if (!session) {
      await ctx.reply("🔗 Vinculá tu Telegram primero. Usá /start.");
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
      await ctx.reply(`❌ Error al abrir mercado: ${e.message}`);
      return;
    }

    let betResult: any;
    try {
      betResult = await placeBet(session, market.id, trade.side, trade.amount);
    } catch (e: any) {
      await ctx.reply(`✅ Mercado abierto, pero error al apostar: ${e.message}\nUsá /markets para apostar.`);
      return;
    }

    const emoji   = trade.side === "long" ? "📈" : "📉";
    const isPaper = trade.mode === "paper";
    const bal     = isPaper
      ? `🎭 Paper balance: $${parseFloat(betResult.new_paper_balance).toFixed(2)}`
      : `💵 Balance real: $${parseFloat(betResult.new_balance).toFixed(2)}`;

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
    if (open.length === 0) return ctx.reply("No hay mercados abiertos.");

    for (const m of open.slice(0, 5)) {
      await ctx.reply(marketCard(m), {
        parse_mode: "Markdown",
        ...marketKeyboard(m.id),
      });
    }
  });

  // Bet on existing market (from market card or /markets list)
  bot.action(/^bet:(.+):(long|short):(\d+)$/, async (ctx) => {
    const [, marketId, side, amountStr] = ctx.match;
    const amount = parseFloat(amountStr);
    const emoji  = side === "long" ? "📈" : "📉";

    let session: any;
    try {
      session = await getSession(ctx.from.id);
    } catch (e: any) {
      return ctx.answerCbQuery(`❌ Error: ${e.message}`, { show_alert: true });
    }
    if (!session) {
      const isGroup = ctx.chat?.type !== "private";
      const msg = isGroup
        ? `Your username isn't linked to any account. Register at ${FRONTEND_URL} or DM the bot and use /start.`
        : `🔗 Link your Telegram first! Create your account at ${FRONTEND_URL} or use /start.`;
      return ctx.answerCbQuery(msg, { show_alert: true });
    }

    let betData: any;
    try {
      betData = await placeBet(session, marketId, side, amount);
    } catch (e: any) {
      return ctx.answerCbQuery(`❌ ${e.message}`, { show_alert: true });
    }

    const paperBal = parseFloat(String(betData.new_paper_balance)).toFixed(2);
    await ctx.answerCbQuery(`${emoji} ${side.toUpperCase()} $${amount} colocado! Paper: $${paperBal}`);

    // Refresh the card with updated pools
    const { rows: [market] } = await db.query(`SELECT * FROM markets WHERE id = $1`, [marketId]);
    if (market) {
      await ctx.editMessageText(
        marketCard(market),
        { parse_mode: "Markdown", ...marketKeyboard(marketId) }
      ).catch(() => {});
    }
  });

  // /link <username> <password> — connect existing web account to this Telegram identity
  bot.command("link", async (ctx) => {
    ctx.deleteMessage().catch(() => {});
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 3) return ctx.reply("Uso: /link <usuario> <contraseña>\nConecta tu cuenta web existente a este Telegram.");
    const [, username, password] = parts;

    let data: any;
    try {
      data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    } catch (e: any) {
      return ctx.reply(`❌ Login fallido: ${e.message}`);
    }

    // Remove telegram_id from the auto-created account (if any), assign to web account
    await db.query(`UPDATE users SET telegram_id = NULL WHERE telegram_id = $1 AND id != $2`, [ctx.from.id, data.user.id]);
    await db.query(`UPDATE users SET telegram_id = $1 WHERE id = $2`, [ctx.from.id, data.user.id]);
    sessions.set(ctx.from.id, { token: data.token, userId: data.user.id, username: data.user.username });

    await ctx.reply(
      `✅ Cuenta web *${data.user.username}* conectada a este Telegram\n\n` +
        `💵 Balance real: $${parseFloat(data.user.balance_usd ?? 0).toFixed(2)}\n` +
        `🎭 Paper balance: $${parseFloat(data.user.paper_balance_usd ?? 0).toFixed(2)}`,
      { parse_mode: "Markdown" }
    );
  });

  // /unlink
  bot.command("unlink", async (ctx) => {
    const { rowCount } = await db.query(`UPDATE users SET telegram_id = NULL WHERE telegram_id = $1`, [ctx.from.id]);
    sessions.delete(ctx.from.id);
    await ctx.reply(rowCount && rowCount > 0
      ? "✅ Cuenta desvinculada."
      : "No tenías ninguna cuenta vinculada."
    );
  });

  // /me
  bot.command("me", async (ctx) => {
    console.log(`[/me] tgId=${ctx.from.id}`);
    const session = await getSession(ctx.from.id);
    console.log(`[/me] session=${session ? session.username : "null"}`);
    if (!session) {
      return ctx.reply("No tenés cuenta. Usá /start para registrarte.");
    }
    const { rows: [user] } = await db.query(
      `SELECT username, balance_usd, paper_balance_usd FROM users WHERE id = $1`, [session.userId]
    );
    console.log(`[/me] user=${user ? user.username : "null"}`);
    if (!user) return ctx.reply("No se encontró tu cuenta.");
    await ctx.reply(
      `👤 ${user.username}\n\n` +
        `💵 Balance real: $${parseFloat(user.balance_usd).toFixed(2)}\n` +
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
        `⚙️ *Tus presets de apuesta:* $${presets.join(" · $")}\n\n` +
        `Para cambiarlos: /settings 5 25 100 500`
      , { parse_mode: "Markdown" });
    }
    const nums = parts.map(Number).filter(n => !isNaN(n) && n > 0);
    if (nums.length !== 4) {
      return ctx.reply("Necesitás exactamente 4 montos. Ej: /settings 5 25 100 500");
    }
    userPresets.set(ctx.from.id, nums);
    await ctx.reply(`✅ Presets actualizados: $${nums.join(" · $")}`);
  });

  // Catch all unhandled bot errors so they don't crash the process
  bot.catch((err: any) => {
    if (err?.response?.error_code === 400 && err?.response?.description?.includes("query is too old")) return;
    console.error("[bot:error]", err?.message ?? err);
  });

  // Register commands so they appear in the / menu
  bot.telegram.setMyCommands([
    { command: "start",    description: "Registrarte o ver tu cuenta" },
    { command: "search",   description: "Buscar un token: /search PEPE" },
    { command: "markets",  description: "Ver mercados abiertos ahora" },
    { command: "me",       description: "Ver tu balance y username" },
    { command: "settings", description: "Ver/cambiar presets: /settings 5 25 100 500" },
    { command: "link",     description: "Conectar tu cuenta web: /link usuario contraseña" },
    { command: "unlink",   description: "Desconectar tu cuenta de Telegram" },
  ]).catch((e) => console.error("[bot] setMyCommands error:", e.message));

  bot.launch();
  console.log("🤖 Telegram bot iniciado");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
