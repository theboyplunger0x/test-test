# FUD.markets — Full Project Context

> This document gives a new AI complete context to continue development on FUD.markets.
> Pair this with the GitHub repo for code access.

---

## What is FUD.markets?

PvP prediction markets for memecoins. Users bet LONG/SHORT on token prices across timeframes (1m, 5m, 15m, 1h, 4h, 24h). Markets resolve automatically via GenLayer AI oracle (decentralized) with DexScreener fallback (centralized).

**One-liner:** "FUD is where any crypto take can be collateralized, challenged, and settled."

**Live URLs:**
- Frontend: https://fud-markets.vercel.app
- Backend: https://fud-markets-backend-production.up.railway.app
- GitHub: the repo you have

---

## Stack

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS + Framer Motion
- **Backend**: Fastify + TypeScript + PostgreSQL (Railway)
- **Auth**: username + password, JWT in localStorage
- **Oracle**: GenLayer (AI consensus) → DexScreener fallback
- **Deploy**: Frontend = Vercel (`vercel --prod` from root). Backend = Railway (`railway up -d --service "FUD. backend" -e production` from `/backend`)
- **Bots**: 20 simulated traders (`npx tsx scripts/live_bots.ts`) with DiceBear avatars and bios

---

## Architecture

### Frontend (`src/`)
```
components/
  FeedPage.tsx          → MAIN component. All tabs, modals, state management
  CoinDetail.tsx        → Token chart page (exchange view) with order book, sweeps
  TokenProfilePage.tsx  → Social token view (calls, chart sparkline, trade panel)
  MarketsView.tsx       → Markets grid with pills: All | Hot X's | Sweep | P2P
  CallCard.tsx          → Social call card with Fade button
  DebateCard.tsx        → Contested market duel view (short vs long callers)
  CallerTokenModal.tsx  → Bottom sheet: trader's call history on a token
  OrdersView.tsx        → User's portfolio drawer (positions, orders, balance)
  ProfileModal.tsx      → Other user's profile popup (stats, calls, follow)
  SpotView.tsx          → Chart tab wrapper (passes symbol to CoinDetail)
  SearchModal.tsx       → CA/ticker search → "Make a call" or "Chart →"
  OpenMarketModal.tsx   → "Make a call" modal (timeframe, side, amount, thesis)
  LeaderboardView.tsx   → Rankings with period pills + winners/losers toggle
  NotificationsPanel.tsx → All notification types rendered
  AuthModal.tsx         → Login/register
  LiveTicker.tsx        → Top scrolling ticker bar

lib/
  api.ts                → HTTP client, all TypeScript types, all API methods
  chartData.ts          → DexScreener OHLCV + token search
  liveCoins.ts          → Curated coin list with live prices
```

### Backend (`backend/src/`)
```
routes/
  markets.ts    → GET/POST /markets, /markets/:id/bet, /positions/recent, /markets/debates, /admin/cleanup
  orders.ts     → POST /orders, /orders/sweep, GET /orders/book, DELETE /orders/:id
  portfolio.ts  → GET /portfolio, POST /withdraw
  auth.ts       → register, login, me, paper-credit, update-profile, X/Telegram OAuth
  users.ts      → GET /users/:username (public profile), GET /users/search
  follows.ts    → follow/unfollow/notify system
  notifications.ts → CRUD notifications
  deposits.ts   → Deposit intents + confirmation

services/
  oracle.ts         → getPrice() (DexScreener), getPriceForResolution() (GenLayer → fallback)
  genLayerOracle.ts → 2-step: deploy contract → call resolve() → read price

workers/
  resolver.ts       → Resolves markets at closes_at. No counterparty → cancel + refund. GenLayer for CA markets, DexScreener fallback.
  depositPoller.ts  → Polls Solana/Base for deposits
  withdrawalProcessor.ts

intelligent-oracles/
  price_oracle.py   → GenLayer Python contract. Fetches DexScreener, LLM parses price, prompt_comparative consensus.

db/
  runMigrations.ts  → Schema + migrations (runs on startup)
  client.ts         → pg Pool
```

---

## Core Business Logic

### Market Lifecycle
1. **Open**: User creates market (symbol, chain, timeframe, CA, tagline) → entry price fetched from DexScreener by CA
2. **Bet**: Users place LONG/SHORT bets → pools grow
3. **Close**: `closes_at` reached → resolver triggers
4. **Resolve**: 
   - No counterparty (one pool = 0) → cancel + refund, no oracle
   - Has CA → GenLayer (deploy oracle → resolve() → read price) → if fails, DexScreener by CA
   - No CA → DexScreener by symbol search
5. **Settle**: winner side gets pool + 95% of loser pool. 5% = house fee.

### Multiplier Formula
```
multiplier = 1 + (otherPool * 0.95) / myPool
```
When pool is lopsided (e.g. $3k short vs $50 long), long multiplier = 58x.

### Order Book / Sweep System
- **Limit orders**: Resting orders in the book, reserved balance
- **Sweep**: Taker fills all matching orders across timeframes proportionally
- **Auto-reopen**: Filled limit orders auto-recreate after resolution
- Markets created by sweeps have `sweep_id` for grouping

### GenLayer Oracle (2-step)
1. Deploy `price_oracle.py` contract with `(symbol, dexscreener_url)` 
2. Call `resolve()` — validators fetch DexScreener, LLM extracts price, `prompt_comparative` consensus
3. Read `get_price()` → return price
4. `leaderOnly: true` for speed on studionet
5. CA-specific URL: `/dex/tokens/{CA}` → exact token, zero ambiguity

---

## Current Tab Structure

```
Calls | Markets | Chart | P2P | Trending | Leaderboard
```

### Markets tab pills: `All | Hot X's | Sweep | P2P`
- **All**: Everything sorted by activity
- **Hot X's**: Multiplier > 5x (amber hot cards with "Sweep 30x · LONG")
- **Sweep**: Only sweep-created markets (have sweep_id)
- **P2P**: Individual markets with Short/Long inline bet buttons

### Navigation Hierarchy (social-first)
- Click any ticker → **Token Profile** (social: calls, chart, trade)
- Token Profile → "Full chart →" → **Chart/CoinDetail** (technical: order book, sweeps)
- All tickers route through `handleCoinClick()` → Token Profile

---

## Pending UX Decisions (from user)

### Feed Unification (decided but not implemented)
The user wants to merge Calls + Markets + P2P into ONE "Feed" tab:
- One card design combining social + opportunity + action
- Hero/Hot cards from Markets stay as promoted items
- Sub-filters: All | Hot | Following
- Chart tab stays as exchange view
- Discover tab needs launchpad filtering (pump.fun, moonshot)

The user explicitly said: "I need to do this work slowly, collapsing and seeing how to build it myself."

### Social Reframe Vision
From ChatGPT/Claude analysis session:
- **Call-first, not trade-first**: "Put money behind any take"
- **Fade as core social action**: Taking the opposite side of someone's call
- **4 entities**: Call Card, Debate Card, Token Stage, Profile Track Record
- **Debates**: Markets where both sides have strong positions (30/70 to 70/30)
- `faded_position_id` column tracks social links between fades

---

## Bot System

20 bots with DiceBear avatars, crypto-native bios. Tokens: DOGE, PEPE, WIF, BONK, SHIB, SOL, BTC (all with CAs).

```bash
# Run bots (from project root)
BASE_URL=https://fud-markets-backend-production.up.railway.app npx tsx scripts/live_bots.ts

# Clean all paper data
curl -X POST .../admin/cleanup -H "Content-Type: application/json" -d '{"secret":"fud-cleanup-2026"}'
```

First wave: all 20 fire immediately. Then 4-7 min between actions. Duration: 4 hours.

---

## Deploy Commands

```bash
# Frontend (from project root)
vercel --prod

# Backend (from /backend)
cd backend && railway up -d --service "FUD. backend" -e production

# IMPORTANT: Do NOT set Root Directory in Railway dashboard. Deploy from /backend dir.
```

---

## Key Environment Variables (Railway)

- `DATABASE_URL` — PostgreSQL connection
- `JWT_SECRET` — Auth signing
- `GENLAYER_RPC_URL` — `https://studio.genlayer.com/api`
- `GENLAYER_PRIVATE_KEY` — For deploying oracle contracts
- `BOT_TOKEN` — Telegram bot
- `X_API_*` — Twitter/X integration

---

## Data TTL

Currently set to **5 minutes** for clean demo:
- Markets: only show open + resolved/cancelled within 5 min
- Positions/recent: only positions from last 5 min
- Tapes: hide when empty, replace entries on each fetch (no merge)

**Change to 24h for production** in `backend/src/routes/markets.ts` — search for `INTERVAL '5 minutes'`.

---

## Known Issues / Tech Debt

1. **GenLayer studionet can be slow/unresponsive** — fallback to DexScreener always works
2. **Token search can return wrong tokens** — CA-based resolution fixes this for markets with CA
3. **Multiple card designs** — CallCard, MarketCard, ChallengeCard need unification
4. **6 tabs** — user wants to reduce to ~4 (Feed unified, Chart, Discover, Leaderboard)
5. **Solana deposit poller** — gets 429 rate limited frequently (not critical, just noisy logs)

---

## Recent Commits (latest first)

```
7aeb14d fix: crash loop — double client.release() in no-counterparty path
9c0fdf1 fix: entry price fetched by CA — same source as resolution
dc65ee0 feat: CA required for all tokens — bots, oracle, resolution
84fd291 fix: GenLayer oracle uses CA-specific DexScreener URL
6ca8c0c fix: GenLayer oracle — simplified contract that actually deploys
92a0460 fix: skip GenLayer oracle when market has no counterparty
69a11ee fix: GenLayer oracle working — 2-step deploy+resolve
f3f5106 feat: markets tab pills (All/Hot X's/Sweep/P2P), P2P cards with inline bet
c739600 feat: social reframe v1 — call-first UX, multi-tf sweep, unified trade panel
```

---

## User Profile & Preferences

- **Name**: Marcos (theboyplunger0x)
- **Role**: Founder/builder, designs UX himself, delegates code execution
- **Communication**: Spanish, direct, visual (sends CSS selectors + screenshots)
- **Preferences**: 
  - Deploy immediately after changes — no batching
  - Terse responses, no filler
  - Don't add features beyond what's asked
  - Social-first product vision inspired by fomo.family
  - GenLayer hackathon participant (Bradbury track)
