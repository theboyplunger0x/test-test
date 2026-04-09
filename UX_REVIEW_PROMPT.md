# Prompt para ChatGPT — Revisión de UX de Settings & Navegación (FUD.markets)

## Contexto del proyecto

**FUD.markets** es un prediction market social de crypto. Los usuarios apuestan LONG/SHORT sobre el precio futuro de tokens en distintos timeframes. Hay 3 modos de trading: Paper (sin dinero real), Testnet (on-chain en testnet), y Real (dinero real).

Features principales:
- **Feed de markets** con tabs: Feed / Calls / P2P / Hot X's
- **Discover** tab (actualmente con sub-vistas: New pairs, Trending, Untouched)
- **Following** tab (usuarios que seguís)
- **Leaderboard** tab
- **Order book / Sweep** (multi-timeframe sweeps)
- **Auth**: username/password + Google + Privy (embedded wallets, external wallets)
- **Notificaciones**, referidos, cashback
- **Cards sociales**: cada posición tiene un mensaje público (la "call")
- **Faded calls**: podés responder/fadear una posición específica

## Settings actual (drawer lateral)

Estructura tal cual está hoy, en orden top-to-bottom:

1. **Header**: Avatar del user + username + "$X real · $Y paper"
2. **Leaderboard** (button, lleva a la tab ranks)
3. **Referrals & Cashback** (abre modal)
4. **Position alerts** (toggle switch — notifs del navegador)
5. **Dark mode** (toggle switch)
6. **Trading mode** (pill toggle: Paper / Testnet)
7. **Wallet section** (solo visible si testnet mode o wallet conectada + usuario logueado):
   - Address con botón COPY
   - 2x2 grid: [+ Fund] [Export]  (solo si login via Privy)
   - 2x2 grid: [Link another] [Disconnect]
   - Si no hay wallet: botón [Connect Wallet] full width
8. **Quick bet amounts** (4 inputs editables: $5, $25, $100, $500)
9. **Sign out** (al final, en rojo)

## Navegación principal (top pill + tabs)

**Pill group** (izquierda):
- Feed | Calls | P2P | Hot X's

**Tabs sueltas** (al lado):
- Discover | Following | Leaderboard

El usuario nota que:
- **Discover** tiene sub-vistas (new/trending/untouched) pero está como tab suelta, se siente raro
- **Leaderboard** está tanto en la tab principal como en Settings — duplicación
- Settings se siente "todo junto" sin jerarquía clara

## Header (barra de arriba)

De izquierda a derecha:
- Logo "FUD.markets"
- Pill group Feed/Calls/P2P/Hot X's
- Tabs Discover/Following/Leaderboard
- Search bar (drop ticker/CA)
- **Balance** (muestra $X real o $X paper según el modo)
- **Action button**: "+ Fund" / "+ Credits" / "Deposit" / "Connect" (cambia según modo y estado)
- **Portfolio button** (icono)
- **Notifications** (icono con contador)
- **Referrals** (icono de caja de regalo)
- **Avatar del user** → abre Settings drawer

## Qué le pido a ChatGPT

Necesito que revises la estructura de Settings y navegación principal de FUD.markets y propongas mejoras. Específicamente:

1. **Jerarquía del Settings drawer**: ¿Cómo agruparías estos 9 items para que se sienta ordenado? ¿Qué sub-secciones tendrías? ¿Qué es "ajustes de cuenta" vs "ajustes de app" vs "acciones"?

2. **Posición de Leaderboard**: Está duplicado (en Settings y como tab). ¿Dónde debería ir?

3. **Discover vs tabs sueltas**: Discover tiene sub-vistas internas pero está al mismo nivel que Feed/Calls. ¿Cómo lo acomodarías?

4. **Wallet section**: ¿Está bien dentro de Settings? ¿O merece su propio drawer/modal dedicado dado que tiene muchas acciones (fund, export, link, disconnect)?

5. **Trading mode + Wallet**: Hoy están ambos en Settings pero se sienten relacionados (testnet mode usa la wallet). ¿Vale la pena unirlos en una sola sección "Trading setup"?

6. **Quick bet amounts**: ¿Está bien en Settings o pertenece a otro lado (ej: dentro del modal de trade)?

7. **Action button del header**: Cambia mucho según contexto (+ Fund / + Credits / Deposit / Connect). ¿Esto confunde? ¿Hay una forma más limpia?

**No quiero que reescribas código.** Dame propuestas conceptuales con justificación UX. Si querés, armá una estructura jerárquica tipo:

```
Settings
├── Account
│   ├── Profile
│   └── ...
├── Trading
│   ├── Mode
│   └── ...
└── ...
```

Y una lista de cambios numerados de mayor a menor prioridad. Sé honesto — si algo está bien como está, decímelo. Si algo está roto conceptualmente, también.
