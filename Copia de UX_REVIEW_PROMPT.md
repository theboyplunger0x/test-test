# UX / Navigation Review — FUD.markets

Soy el founder de FUD.markets. Necesito una revisión profunda de UX y navegación. Debajo tenés todo el contexto que necesitás: qué es el producto, a quién apunta, qué hace cada pieza, y dónde siento que las cosas están desordenadas. Leé todo antes de responder.

---

## 1. Qué es FUD.markets

**Un prediction market social para crypto.** Los usuarios apuestan LONG o SHORT sobre el precio futuro de cualquier token (meme coins, tokens chicos, majors) en distintos timeframes (1m / 5m / 15m / 1h / 4h / 12h / 24h).

**No es Polymarket.** Polymarket es YES/NO sobre eventos. FUD es LONG/SHORT sobre precios, como un exchange de perps pero parimutuel.

**No es un DEX.** No hay leverage, no hay liquidaciones, no hay funding rates. Cada market es una apuesta discreta entre un pool LONG y un pool SHORT. Al cierre del timeframe, un oracle resuelve el precio y el lado ganador se lleva ambos pools menos un 5% de fee. Multiplicador = `1 + (otherPool * 0.95) / myPool`.

**Es social.** Cada posición tiene un mensaje público (la "call"). Vos no solo apostás: publicás por qué. Otros usuarios pueden "fadear" tu call (tomar el lado contrario, respondiendo específicamente a tu apuesta). Hay perfiles, follows, leaderboard, referidos.

**El DNA es degen.** El tono de la app es crypto-twitter: "nfa but loading bags", "ngmi if you fade this", "rug incoming screenshot this". El público son degens que ya postean sus calls en X/Telegram y les damos un lugar donde ponerle plata.

## 2. Stack técnico

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind + Framer Motion. Single page, el componente `FeedPage.tsx` maneja casi toda la UI (tabs, modals, drawers).
- **Backend**: Fastify + Postgres, API REST. Hosted en Railway.
- **Oracle**: GenLayer (intelligent contracts que consensúan precio de DexScreener). Actualmente en studionet (paper markets) y Bradbury testnet.
- **Auth**: username/password + Google OAuth + Privy (embedded wallets + external wallets). Queremos migrar todo a Privy eventualmente.
- **Bots**: X agent + Telegram bot que postean trades y responden. Hay un simulador de 20 bots que crean actividad falsa en paper mode.

## 3. Trading modes (clave para entender la nav)

Hay tres modos que el usuario elige desde Settings → Trading mode:

1. **Paper** (default). Balance ficticio en USD. No hay wallet. Usado para onboarding y demo.
2. **Real**. USD real. El usuario conecta o crea una wallet via Privy (embedded wallet en Base Sepolia por ahora, Base mainnet en prod). Deposita USDC. Trades son on-chain.
3. **Testnet** (actualmente oculto — viejo modo que usábamos para la hackathon de GenLayer). Queda en el código por si volvemos.

El modo actual afecta **qué ve el usuario**: los markets se filtran por `is_paper` vs `is_testnet` vs real. El balance display cambia. El botón de acción cambia.

## 4. Navegación actual (layout)

### Header (barra superior)

De izquierda a derecha:

```
[Logo FUD.] [Feed|Calls|P2P|Hot X's] [Discover] [Following] [Leaderboard]   [Search bar]   [Balance display] [Action button] [Portfolio icon] [Notifs icon] [Referrals icon] [Avatar]
```

- **Logo** — no hace nada (podría ir a home)
- **Pill group**: 4 sub-vistas agrupadas visualmente en una "pill". Son todas vistas del feed de markets pero filtradas:
  - **Feed**: todos los markets open (hero + grid + tape sidebar)
  - **Calls**: solo cards sociales con mensajes
  - **P2P**: solo markets P2P individuales (sin sweeps)
  - **Hot X's**: markets con multiplicadores altos (>= 15x)
- **Tabs sueltas** (al lado del pill, al mismo nivel visual):
  - **Discover**: nueva sección que tiene sub-vistas internas (New pairs / Trending / Untouched) que aparecen como tabs secundarias cuando entrás
  - **Following**: feed de trades de gente que seguís
  - **Leaderboard**: ranking de top traders
- **Search bar**: pegás un $ticker o un CA (contract address) para buscar el token y abrir su página
- **Balance display**: muestra `$X Paper`, `$X Balance` (real), o la address truncada + GEN en testnet
- **Action button**: cambia según contexto:
  - Paper → "+ Credits" (abre modal para sumar paper balance)
  - Real sin wallet → "Connect" (abre modal de auth/Privy)
  - Real con wallet → "+ Fund" (abre el modal de fondeo de Privy)
  - Testnet sin wallet → "Connect"
  - Testnet con wallet → "+ Fund"
- **Portfolio icon**: abre un drawer con las posiciones abiertas del user
- **Notifs icon**: muestra unread count, abre panel de notificaciones
- **Referrals icon**: abre modal de referidos/cashback
- **Avatar**: abre el **Settings drawer** (ver sección 5)

### Mobile

En mobile las tabs y el pill se apretujan, el search bar se achica, la action button/balance quedan a la derecha. No hay una nav inferior estilo app mobile — todo sigue siendo top bar.

## 5. Settings drawer (el punto central de este review)

Cuando tocás el avatar, se abre un drawer lateral desde la derecha. Estructura actual, top a bottom:

```
┌─────────────────────────────────┐
│ [avatar] username            [X]│
│          $X real · $Y paper     │
├─────────────────────────────────┤
│ 🏆 Leaderboard                →│  (navega a la tab Leaderboard)
│ 🎁 Referrals & Cashback        │  (abre modal)
│ 🔔 Position alerts        [ON] │  (toggle: notifs del browser)
│ 🌙 Dark mode              [ON] │  (toggle: theme)
│ 🃏 Trading mode    [Paper|Real]│  (pill toggle)
│ 🔐 Wallet                       │  (solo si Real/Testnet + logged in)
│    0x1234...abcd  [COPY]       │
│    [+ Fund]        [Export]    │
│    [Link another]  [Disconnect]│
│ 💰 Quick bet amounts           │
│    [5] [25] [100] [500]        │
├─────────────────────────────────┤
│ ↩ Sign out                     │
└─────────────────────────────────┘
```

**Qué hace cada cosa:**

1. **Header del drawer**: avatar + username + balances resumidos
2. **Leaderboard**: atajo a la tab Leaderboard (que también está en el header). Duplicación.
3. **Referrals & Cashback**: abre modal independiente. El user ve su código de referido, cuánta plata ganó, tier actual, historial de rewards.
4. **Position alerts**: habilita notifs del browser cuando se resuelve un market donde el user tiene posición.
5. **Dark mode**: switchea tema light/dark.
6. **Trading mode**: switchea entre Paper y Real. Impacta toda la app (qué markets se muestran, qué balance, qué pasa al apostar).
7. **Wallet**: solo aparece si el user está logueado y está en modo Real (o Testnet). Muestra la wallet conectada (puede ser Privy embedded o external como MetaMask). Permite fondear, exportar la seed phrase, conectar otra wallet externa, desconectar.
8. **Quick bet amounts**: cuatro inputs editables que definen los shortcuts de montos en el trade modal. Si el user pone 5/25/100/500, cuando vaya a apostar verá esos botones.
9. **Sign out**: desloguea del backend + Privy.

## 6. Lo que me molesta / siento que está desordenado

Soy el dev y el user #1. Te cuento mis tensiones sin filtros:

### Tensión 1 — Settings es una ensalada
Mezcla navegación (Leaderboard es una tab, no un setting), features (Referrals abre un modal full-screen), toggles de app (dark mode, notifs), configuración de trading (mode, quick amounts), y gestión de wallet (address, fund, export, link, disconnect). **Son categorías distintas viviendo en el mismo drawer sin agrupar.** Se siente que no tiene jerarquía.

### Tensión 2 — Leaderboard duplicado
Está como tab suelta en la top nav Y como item en Settings. ¿Cuál es el correcto? Si es una tab principal, no debería estar en Settings. Si es un ajuste secundario, no debería ser tab principal.

### Tensión 3 — Discover es raro
Está en la top nav como tab suelta al mismo nivel que Feed/Calls/P2P/Hot X's, pero **adentro tiene sus propias sub-tabs** (New / Trending / Untouched). Eso genera una jerarquía rara: ¿Discover es un sibling de Feed, o es otra cosa? Feed/Calls/P2P/Hot X's son filtros de la misma data (markets). Discover es otra data (tokens trending, no markets). Probablemente debería estar más separado visualmente.

### Tensión 4 — Action button polimórfico
El botón del header cambia entre "+ Credits" / "+ Fund" / "Deposit" / "Connect" según el modo y el estado. **No tengo dudas de qué hace** porque yo lo diseñé, pero un user nuevo puede no entender. ¿Está bien que cambie tanto, o debería ser algo más estable?

### Tensión 5 — Wallet section en Settings
Cuando estás en modo Real con wallet conectada, la wallet section de Settings tiene 5+ acciones (COPY, Fund, Export, Link another, Disconnect). Eso es **un feature grande metido en un setting**. ¿Merece su propio drawer/modal como "Portfolio" o "Notifs"? ¿O está bien donde está?

### Tensión 6 — Quick bet amounts
Es una configuración que solo impacta el trade modal. ¿Tiene sentido que viva en Settings general? ¿O debería estar oculto atrás de un gear icon dentro del trade modal mismo?

### Tensión 7 — Trading mode es existencial
Switchear entre Paper y Real cambia toda la app. Pero está enterrado como un toggle más en Settings, al lado de "Dark mode". Eso se siente subvalorado. ¿Merece estar más visible? ¿En el header tal vez?

### Tensión 8 — No hay "profile" del user mismo
El user puede ver su propio perfil navegando al link de su avatar, pero no hay una sección clara "tu cuenta" dentro de Settings. Si quiere cambiar el avatar, bio, username — hoy no hay UI clara para eso.

## 7. Público objetivo

- **Degens crypto** que postean sus calls en CT (crypto Twitter) y Telegram
- **Edad 20-35**, mobile-first pero usan mucho desktop también
- **Ya usan MetaMask** o al menos vieron uno
- **No quieren ver un flow de "onboarding educativo"** — quieren abrir la app, ver markets, apostar
- **Pero también queremos atraer normies** que no tengan wallet → por eso Privy con embedded wallets (login con Google/email → Privy crea wallet encriptada → el user no ve seed phrases a menos que quiera exportar)

## 8. Qué te pido

1. **Revisá cada tensión de la sección 6** y dame una opinión honesta. Si pensás que alguna está bien como está, decílo. Si pensás que está rota, proponé cómo.

2. **Proponé una jerarquía nueva del Settings drawer** con sub-secciones claras. Algo como:
   ```
   Settings
   ├── Account (profile, username, avatar, email)
   ├── Trading (mode, quick amounts, default timeframe)
   ├── Wallet (address, fund, export, link, disconnect)
   ├── Appearance (dark mode, language)
   ├── Notifications (position alerts, email alerts, bot alerts)
   └── [Sign out]
   ```
   Pero justificá por qué esa estructura, no me tires una al azar.

3. **Decidime el lugar correcto de Leaderboard**. Una sola opción, justificada.

4. **Proponé cómo separar Discover de los filtros del feed**. La jerarquía actual es confusa: Feed/Calls/P2P/Hot X's son filtros del mismo dataset (markets), mientras que Discover es otro dataset (tokens). ¿Cómo lo acomodarías visualmente?

5. **Si el action button polimórfico es un problema**, proponé alternativas concretas. Puede ser: un solo botón estable ("Wallet") que abra un drawer con todas las opciones; un botón "+ Deposit" universal que haga lo correcto según el modo; o justificar que está bien como está.

6. **Decidí si la wallet section merece su propio drawer dedicado**. Si sí, explicá cómo se accedería (botón en el header? item en Settings que lleva a ese drawer?).

7. **Quick bet amounts**: ¿Settings o trade modal? Una sola opción.

8. **Trading mode**: ¿En Settings o más visible? Si más visible, ¿dónde?

9. **Profile del user**: ¿Cómo debería acceder el user a editar su propio perfil (avatar, bio, username)?

10. **Prioridades**: dame una lista de cambios numerados de 1 a N, de alto a bajo impacto. Yo voy a elegir qué hacer primero.

## 9. Reglas para tu respuesta

- **No me reescribas código**. Dame propuestas conceptuales.
- **Sé específico**. No me digas "agregá jerarquía" — decíme "poné una sub-sección Account con X, Y, Z porque razón A".
- **Sé honesto**. Si hay algo que propongo que pensás que es mala idea, decílo. Si hay algo que no mencioné que deberías arreglar, decílo también.
- **Pensá en mobile y desktop**. No optimices solo para uno.
- **Pensá en el user nuevo Y en el power user**. Los dos tienen que encontrar lo que buscan.
- **No hagas overload de animaciones/efectos**. El estilo actual es minimalista dark, texto font-black, pocos colores (emerald/red/yellow/purple como acentos). Mantené ese lenguaje.

Cuando termines, quiero poder agarrar tu respuesta y traducirla a cambios concretos en el código sin ambigüedades.
