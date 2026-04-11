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
  getUserRewardBalance,
  getRewardReserve,
  depositForOnChain,
  withdrawBySigOnChain,
  VAULT_CONFIG,
} from "../services/vaultService.js";
import { parseUnits } from "viem";

export async function vaultRoutes(app: FastifyInstance) {

  // GET /vault/config — frontend needs this for EIP-712 domain + contract address
  app.get("/vault/config", async () => {
    return VAULT_CONFIG;
  });

  // GET /vault/balance/:address — user's USDC balance (Main Wallet + vault combined)
  app.get("/vault/balance/:address", async (req, reply) => {
    const { address } = req.params as any;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({ error: "Invalid address" });
    }
    // Read both vault balance AND USDC wallet balance
    const vaultBalance = await getUserBalance(address as `0x${string}`);
    // Also read USDC directly in the Main Wallet (deposited but not yet in vault)
    let walletUsdcBalance = "0";
    try {
      const { createPublicClient, http, formatUnits } = await import("viem");
      const { baseSepolia } = await import("viem/chains");
      const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org") });
      const raw = await client.readContract({
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
        abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as bigint;
      walletUsdcBalance = formatUnits(raw, 6);
    } catch {}
    // Total = vault balance + USDC sitting in Main Wallet
    const total = (parseFloat(vaultBalance) + parseFloat(walletUsdcBalance)).toFixed(6);
    return { address, balance: total, vaultBalance, walletUsdcBalance };
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

  // GET /vault/rewards/:address — user's claimable reward balance
  app.get("/vault/rewards/:address", async (req, reply) => {
    const { address } = req.params as any;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({ error: "Invalid address" });
    }
    const rewards = await getUserRewardBalance(address as `0x${string}`);
    return { address, rewards };
  });

  // GET /vault/reserve — total reward reserve in the contract
  app.get("/vault/reserve", async () => {
    const reserve = await getRewardReserve();
    return { reserve };
  });

  // POST /vault/deposit-for — operator deposits USDC on behalf of a Main Wallet
  app.post("/vault/deposit-for", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { account, amount } = req.body as any;
    if (!account || !/^0x[a-fA-F0-9]{40}$/.test(account)) {
      return reply.status(400).send({ error: "Invalid account address" });
    }
    if (!amount || amount <= 0) {
      return reply.status(400).send({ error: "Amount must be > 0" });
    }
    try {
      const amountRaw = parseUnits(amount.toString(), 6);
      const txHash = await depositForOnChain(account as `0x${string}`, amountRaw);
      return { txHash, account, amount };
    } catch (e: any) {
      return reply.status(500).send({ error: e.shortMessage ?? e.message ?? "Deposit failed" });
    }
  });

  // POST /vault/withdraw-by-sig — gasless withdrawal signed by Main Wallet
  app.post("/vault/withdraw-by-sig", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { account, to, amount, nonce, deadline, signature } = req.body as any;
    if (!account || !to || !amount || !signature) {
      return reply.status(400).send({ error: "Missing required fields" });
    }
    try {
      const txHash = await withdrawBySigOnChain(
        account as `0x${string}`,
        to as `0x${string}`,
        parseUnits(amount.toString(), 6),
        BigInt(nonce),
        BigInt(deadline),
        signature as `0x${string}`
      );
      return { txHash, account, to, amount };
    } catch (e: any) {
      return reply.status(500).send({ error: e.shortMessage ?? e.message ?? "Withdrawal failed" });
    }
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
