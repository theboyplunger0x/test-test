# Buscar template de escrow para prediction market — FUD.markets

Necesito un **smart contract escrow** para un prediction market de crypto. Buscá en GitHub, en proyectos de DeFi conocidos, en auditorías públicas, en Gitcoin, en OpenZeppelin Defender, donde sea. Tiene que ser código **auditado** o al menos **battle-tested en producción con volumen real**.

## Qué hace el contrato

Es un escrow parimutuel para apuestas binarias LONG/SHORT sobre precios de tokens crypto:

1. **Crear market**: backend llama `createMarket(marketId, closesAt)` para registrar un nuevo market
2. **Apostar**: user llama `bet(marketId, side, amount)` donde `side` es LONG o SHORT. El user previamente hizo `approve()` de USDC. El contrato transfiere los USDC del user y los guarda en el pool correspondiente del market
3. **Resolver**: después del close time, un oracle (externo o el backend firmando) llama `resolve(marketId, winnerSide, exitPrice)`. Marca el market como resuelto y guarda el ganador
4. **Claim**: los ganadores llaman `claim(marketId)` y reciben su payout en USDC. El payout es parimutuel: `amount + (loserPool * 0.95 / winnerPool) * amount`. El 5% del loserPool es house fee que va a una treasury wallet
5. **Cancel**: si el oracle falla, backend llama `cancel(marketId)` y todos los users pueden reclamar su apuesta original (refund)

## Requerimientos clave

- **Un solo contrato maestro** (pool pattern), no un contrato por market
- **USDC** como colateral (ERC-20, no ETH nativo)
- **Parimutuel payouts** (no order book, no AMM)
- **Permissioned resolver**: solo una dirección específica puede llamar `resolve()` y `cancel()`
- **House fee** configurable (default 5%) que va a una treasury address
- **Sin leverage**, sin liquidations, sin funding rates
- **Sin upgradability** en v1 (más simple, menos superficie de ataque)
- **Escrito en Solidity** para EVM (Base, BSC, Ethereum)
- **Idealmente**: también disponible en **Anchor (Rust) para Solana** o en **Move para Sui/Aptos**

## Ejemplos que pueden servir de base

Buscá estos proyectos y decime si tienen código público que sirva:

- **Polymarket**: usan CTF (Conditional Tokens Framework) de Gnosis, pero su código específico está en github.com/Polymarket. Tienen escrow contracts
- **Azuro Protocol**: protocol de betting descentralizado. Tienen escrow contracts auditados
- **Overtime / ThalesMarket**: prediction market sports, usan escrow
- **Augur v2**: uno de los primeros prediction markets, contratos auditados
- **SX Network**: sports betting, tiene escrow on-chain
- **Prophet Finance**: prediction market para crypto
- **Limitless / Limitless.exchange**: prediction market moderno (2024)
- **Gnosis Conditional Tokens**: framework de OpenZeppelin/Gnosis para crear markets con escrow
- **OpenZeppelin Contracts**: buscar si tienen algo de `Escrow` o `ConditionalEscrow` que sirva como base

También mirá:
- Gitcoin bounties de prediction markets
- Paradigm research / blog posts con código
- Auditorías públicas de Trail of Bits, ConsenSys Diligence, Spearbit, Certik sobre prediction markets

## Qué quiero que me devuelvas

Para cada candidato encontrado:

1. **Link al repo** (GitHub URL directo al contrato)
2. **Estado de auditoría** (quién auditó, cuándo, link al reporte si hay)
3. **Licencia** (MIT? GPL? Propietario?)
4. **Match con mis requerimientos** — ¿cuán cerca está de lo que necesito? ¿Qué hay que adaptar?
5. **Volumen o TVL histórico** si lo conocés
6. **Red flags** — cosas que viste que no te gustan
7. **Versión Solidity** (>=0.8.0 idealmente)

Si encontrás templates también para Solana (Anchor) o BSC, incluilos. BSC usa EVM así que cualquier contrato Solidity funciona. Solana sí necesita Anchor.

**Prioridá los que estén auditados y battle-tested sobre los que se vean bonitos en GitHub pero nadie usó.**

## Contexto rápido del proyecto

FUD.markets es un prediction market social para crypto. Los users apuestan LONG/SHORT sobre el precio de cualquier token en timeframes cortos (1m, 5m, 15m, 1h, 4h, 12h, 24h). Multichain (Base, BSC, Solana). MVP en Base Sepolia. Privy para auth + embedded wallets. Full on-chain escrow. Oracle: todavía decidiendo (backend signer vs Pyth vs UMA).

No necesito el mejor contrato del mundo. Necesito el mejor contrato auditado que podamos adaptar en un par de días.
