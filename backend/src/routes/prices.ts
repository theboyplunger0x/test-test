import { FastifyInstance } from "fastify";

const DS_CHAIN: Record<string, string> = {
  SOL: "solana", BASE: "base", ETH: "ethereum", BSC: "bsc",
};

// ── Pair address cache ────────────────────────────────────────────────────────
// "WOJAK:SOL" → { chainId: "solana", pairAddress: "0xabc..." }
const pairCache = new Map<string, { chainId: string; pairAddress: string }>();

async function resolvePair(symbol: string, chain: string): Promise<{ chainId: string; pairAddress: string } | null> {
  const key = `${symbol.toUpperCase()}:${chain.toUpperCase()}`;
  if (pairCache.has(key)) return pairCache.get(key)!;

  const chainId = DS_CHAIN[chain.toUpperCase()] ?? "solana";
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`, {
      headers: { "User-Agent": "MemeBets/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const pairs: any[] = data.pairs ?? [];
    const onChain = pairs
      .filter((p) => p.chainId === chainId && p.priceUsd && parseFloat(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    if (!onChain[0]) return null;
    const entry = { chainId, pairAddress: onChain[0].pairAddress as string };
    pairCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// ── Shared 1.5s price cache (shared across all SSE clients) ──────────────────
type PriceEntry = { price: number; fetchedAt: number };
const priceCache = new Map<string, PriceEntry>();
let fetchInFlight = false;

// Fetch prices for a set of pair addresses, update priceCache
async function fetchBatch(pairsToFetch: { key: string; chainId: string; pairAddress: string }[]) {
  if (fetchInFlight || pairsToFetch.length === 0) return;
  fetchInFlight = true;
  try {
    // Group by chainId for efficient batch requests (DexScreener supports comma-separated pair addresses per chain)
    const byChain: Record<string, { key: string; pairAddress: string }[]> = {};
    for (const { key, chainId, pairAddress } of pairsToFetch) {
      if (!byChain[chainId]) byChain[chainId] = [];
      byChain[chainId].push({ key, pairAddress });
    }

    for (const [chainId, items] of Object.entries(byChain)) {
      const addrs = items.map((i) => i.pairAddress).join(",");
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chainId}/${addrs}`, {
          headers: { "User-Agent": "MemeBets/1.0" },
        });
        if (!res.ok) continue;
        const data = await res.json() as any;
        const pairsData: any[] = data.pairs ?? (data.pair ? [data.pair] : []);
        for (const pair of pairsData) {
          if (!pair?.priceUsd) continue;
          // Match by pairAddress
          const item = items.find((i) => i.pairAddress.toLowerCase() === pair.pairAddress?.toLowerCase());
          if (item) {
            priceCache.set(item.key, { price: parseFloat(pair.priceUsd), fetchedAt: Date.now() });
          }
        }
      } catch {}
    }
  } finally {
    fetchInFlight = false;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function priceRoutes(app: FastifyInstance) {

  /**
   * GET /prices/live?symbols=WOJAK:SOL,PEPE:ETH
   * Server-Sent Events stream — pushes price map every ~1.5s
   */
  app.get("/prices/live", async (req, reply) => {
    const { symbols } = req.query as { symbols?: string };
    if (!symbols) {
      return reply.status(400).send({ error: "symbols query param required (e.g. WOJAK:SOL,PEPE:ETH)" });
    }

    const requested = symbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .map((s) => {
        const [sym, chain] = s.split(":");
        return { sym, chain: chain ?? "SOL", key: s };
      });

    // Resolve pair addresses (async, staggered to avoid hitting rate limits)
    const resolved: { key: string; chainId: string; pairAddress: string }[] = [];
    for (const { sym, chain, key } of requested) {
      const pair = await resolvePair(sym, chain);
      if (pair) resolved.push({ key, ...pair });
      await new Promise((r) => setTimeout(r, 150)); // 150ms between lookups
    }

    if (resolved.length === 0) {
      return reply.status(404).send({ error: "No pair addresses found for requested symbols" });
    }

    // ── Set up SSE ────────────────────────────────────────────────────────────
    reply.raw.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    });
    reply.raw.flushHeaders?.();

    let closed = false;
    req.raw.on("close", () => { closed = true; });

    function sendPrices() {
      if (closed) return;
      const now = Date.now();
      const stale = resolved.filter((r) => {
        const c = priceCache.get(r.key);
        return !c || now - c.fetchedAt > 1400; // refresh if older than 1.4s
      });

      const doSend = () => {
        if (closed) return;
        const out: Record<string, number> = {};
        for (const { key } of resolved) {
          const c = priceCache.get(key);
          if (c) out[key] = c.price;
        }
        if (Object.keys(out).length > 0) {
          try { reply.raw.write(`data: ${JSON.stringify(out)}\n\n`); } catch {}
        }
      };

      if (stale.length > 0) {
        fetchBatch(stale).then(doSend).catch(doSend);
      } else {
        doSend();
      }
    }

    // Send initial prices immediately
    sendPrices();

    // Then push every 1.5s
    const interval = setInterval(() => {
      if (closed) { clearInterval(interval); return; }
      sendPrices();
    }, 1500);

    // Keepalive comment every 20s to prevent proxy timeouts
    const keepalive = setInterval(() => {
      if (closed) { clearInterval(keepalive); return; }
      try { reply.raw.write(": keepalive\n\n"); } catch { clearInterval(keepalive); }
    }, 20_000);

    req.raw.on("close", () => {
      clearInterval(interval);
      clearInterval(keepalive);
    });

    // Fastify — don't call reply.send() for SSE, raw stream handles it
    await new Promise<void>((resolve) => req.raw.on("close", resolve));
  });

  /**
   * GET /prices?symbols=WOJAK:SOL,PEPE:ETH
   * Snapshot (single fetch) — fallback / initial load
   */
  app.get("/prices", async (req, reply) => {
    const { symbols } = req.query as { symbols?: string };
    if (!symbols) return reply.status(400).send({ error: "symbols required" });

    const requested = symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).map((s) => {
      const [sym, chain] = s.split(":");
      return { sym, chain: chain ?? "SOL", key: s };
    });

    const resolved: { key: string; chainId: string; pairAddress: string }[] = [];
    for (const { sym, chain, key } of requested) {
      const pair = await resolvePair(sym, chain);
      if (pair) resolved.push({ key, ...pair });
    }

    await fetchBatch(resolved);

    const out: Record<string, number> = {};
    for (const { key } of resolved) {
      const c = priceCache.get(key);
      if (c) out[key] = c.price;
    }
    return out;
  });
}
