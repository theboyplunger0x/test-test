# FUD.markets — Contexto del Proyecto

## Descripcion
Prediction markets de crypto. Los usuarios apuestan LONG/SHORT sobre el precio futuro de tokens en distintos timeframes. Hay mercados reales y en modo "paper" (sin dinero real).

## Stack
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + Framer Motion
- **Backend**: API REST en `http://localhost:3001` (variable: `NEXT_PUBLIC_API_URL`)
- **Auth**: username + password. JWT guardado en `localStorage` con key `"token"`
- **Oracle**: GenLayer (descentralizado, consenso de validadores)

## Estructura del frontend (`src/`)
```
app/
  page.tsx              → entry point, renderiza <FeedPage>
  layout.tsx
  auth/callback/page.tsx
  reset-password/page.tsx

components/
  FeedPage.tsx          → componente principal (toda la UI: feed, tabs, modales)
  CoinDetail.tsx        → vista detalle de un token/mercado
  TradePanel.tsx        → panel para hacer apuestas long/short
  Chart.tsx             → grafico de precio
  LiveTicker.tsx        → ticker con precios en tiempo real
  LiveView.tsx          → vista de mercados en vivo
  OrdersView.tsx        → historial de posiciones del usuario
  NewPairsView.tsx      → nuevos pares (scout mode)
  ChallengesFeed.tsx    → feed de challenges/mercados
  AuthModal.tsx         → login / registro (username + password)
  DepositModal.tsx      → depositar fondos
  OpenMarketModal.tsx   → crear un nuevo mercado
  CASearchModal.tsx     → buscar token por contract address

lib/
  api.ts                → cliente HTTP, todos los tipos TypeScript y metodos del API
  mockData.ts           → datos mock de coins
  mockChallenges.ts     → datos mock de challenges
  liveCoins.ts          → STATIC_COINS + fetchLiveCoins()
  chartData.ts          → tipo TokenInfo y datos de grafico
```

## Tipos principales (en `lib/api.ts`)
- `User` — id, username, balance_usd, paper_balance_usd
- `Market` — symbol, chain, timeframe, entry_price, long_pool, short_pool, status, is_paper
- `Position` — apuesta de un usuario en un mercado
- `AuthResponse` — token + user

## API endpoints principales
- `POST /auth/register` / `/auth/login` / `/auth/me`
- `POST /auth/forgot-password` / `/auth/reset-password`
- `POST /auth/paper-credit` — creditar balance paper
- `GET /markets` / `POST /markets` — listar/crear mercados
- `POST /markets/:id/bet` — apostar en un mercado
- `GET /portfolio` — posiciones del usuario

## Logica de negocio clave
- Fee: 5% sobre el pool perdedor
- Multiplier: `1 + (otherPool * 0.95) / myPool`
- Timeframes disponibles: 5m, 15m, 1h, 4h, 12h, 24h
- Modo paper: apuestas sin dinero real, balance separado `paper_balance_usd`
- Oracle: GenLayer resuelve el precio al cierre del mercado (ver `backend/src/workers/resolver.ts`)

## UI / Diseño
- Tema dark/light toggleable
- Layout: tabs principales "Feed" y "Scout"
- Scout tiene sub-vistas: new, trending, untouched
- Filtros de feed: all, hot, juicy
- Quick amounts: $10, $25, $50, $100
