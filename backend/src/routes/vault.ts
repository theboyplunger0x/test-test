/**
 * Vault routes — on-chain FUDVault interaction for Real mode.
 *
 * These routes complement the existing /markets and /markets/:id/bet routes
 * (which handle paper + DB-only flow). When a market is created in Real mode,
 * it also gets created on-chain via the vault. When a user bets in Real mode,
 * the EIP-712 signed bet is forwarded to the contract.
 */
import { FastifyInstance } from "fastify";
import {
  getMarketOnChain,
  getUserBalance,
  getUserNonce,
  VAULT_CONFIG,
} from "../services/vaultService.js";

export async function vaultRoutes(app: FastifyInstance) {

  // GET /vault/config — frontend needs this for EIP-712 domain + contract address
  app.get("/vault/config", async () => {
    return VAULT_CONFIG;
  });

  // GET /vault/balance/:address — user's on-chain vault balance
  app.get("/vault/balance/:address", async (req, reply) => {
    const { address } = req.params as any;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({ error: "Invalid address" });
    }
    const balance = await getUserBalance(address as `0x${string}`);
    return { address, balance };
  });

  // GET /vault/nonce/:address — user's current nonce for signing bets
  app.get("/vault/nonce/:address", async (req, reply) => {
    const { address } = req.params as any;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({ error: "Invalid address" });
    }
    const nonce = await getUserNonce(address as `0x${string}`);
    return { address, nonce: nonce.toString() };
  });

  // GET /vault/market/:id — read on-chain market state
  app.get("/vault/market/:id", async (req, reply) => {
    const { id } = req.params as any;
    const marketId = parseInt(id, 10);
    if (isNaN(marketId) || marketId < 0) {
      return reply.status(400).send({ error: "Invalid market ID" });
    }
    const market = await getMarketOnChain(BigInt(marketId));
    return market;
  });
}
