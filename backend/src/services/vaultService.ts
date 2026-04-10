/**
 * FUDVault on-chain service — interacts with the deployed FUDVault.sol
 * on Base Sepolia (testnet) and eventually Base mainnet.
 *
 * The backend acts as "operator" — it creates markets, submits user-signed
 * bets, and resolves/cancels markets. Users deposit/withdraw directly.
 */
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, decodeEventLog, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = JSON.parse(readFileSync(join(__dirname, "../abi/FUDVault.json"), "utf-8"));

// ─── Config ──────────────────────────────────────────────────────────────────

const VAULT_ADDRESS = (process.env.FUDVAULT_ADDRESS ?? "0x0A8a0e81B9fcCd8273AfF3D27741df4126c1Ce18") as Address;
const OPERATOR_KEY  = process.env.FUDVAULT_OPERATOR_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
const RPC_URL       = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const CHAIN         = baseSepolia; // swap to `base` for mainnet

// USDC has 6 decimals
const USDC_DECIMALS = 6;

// Price precision — we store 1e8 on-chain (same as Chainlink)
const PRICE_DECIMALS = 8;

function getClients() {
  if (!OPERATOR_KEY) throw new Error("FUDVAULT_OPERATOR_KEY or DEPLOYER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(`0x${OPERATOR_KEY.replace(/^0x/, "")}` as Hex);
  const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });
  return { publicClient, walletClient, account };
}

// ─── Write Operations (operator) ─────────────────────────────────────────────

/**
 * Create a market on-chain. Returns the on-chain market ID.
 */
export async function createMarketOnChain(closesAtUnix: number, entryPrice: number): Promise<bigint> {
  const { publicClient, walletClient } = getClients();
  const entryPrice1e8 = BigInt(Math.round(entryPrice * 10 ** PRICE_DECIMALS));

  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "createMarket",
    args: [BigInt(closesAtUnix), entryPrice1e8],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Extract marketId from MarketCreated event
  const event = receipt.logs.find((log: any) => {
    try {
      decodeEventLog({ abi, eventName: "MarketCreated", topics: log.topics, data: log.data });
      return true;
    } catch { return false; }
  });

  if (!event) throw new Error("MarketCreated event not found in tx receipt");
  const decoded = decodeEventLog({ abi, eventName: "MarketCreated", topics: event.topics as any, data: event.data as any });
  return (decoded.args as any).marketId as bigint;
}

/**
 * Place a bet on behalf of a user. The user must have signed an EIP-712
 * message off-chain (frontend handles this via wallet).
 */
export async function placeBetOnChain(
  marketId: bigint,
  userAddress: Address,
  side: "long" | "short",
  amountUsd: number,
  nonce: bigint,
  userSignature: Hex
): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const sideEnum = side === "long" ? 0 : 1;
  const amount = parseUnits(amountUsd.toString(), USDC_DECIMALS);

  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "placeBet",
    args: [marketId, userAddress, sideEnum, amount, nonce, userSignature],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Resolve a market on-chain with the exit price.
 * The contract handles draw detection (exit == entry → cancel + refund).
 */
export async function resolveMarketOnChain(marketId: bigint, exitPrice: number): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const exitPrice1e8 = BigInt(Math.round(exitPrice * 10 ** PRICE_DECIMALS));

  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "resolveMarket",
    args: [marketId, exitPrice1e8],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Cancel a market and refund all bets on-chain.
 */
export async function cancelMarketOnChain(marketId: bigint): Promise<string> {
  const { publicClient, walletClient } = getClients();

  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "cancelMarket",
    args: [marketId],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Deposit USDC on behalf of a user's Main Wallet (gasless for user).
 * Operator sends USDC from its balance and credits the account.
 */
export async function depositForOnChain(account: Address, amountRaw: bigint): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "depositFor",
    args: [account, amountRaw],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Execute gasless withdrawal signed by user's Main Wallet.
 */
export async function withdrawBySigOnChain(
  account: Address,
  to: Address,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
  signature: `0x${string}`
): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "withdrawBySig",
    args: [account, to, amount, nonce, deadline, signature],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ─── Read Operations ─────────────────────────────────────────────────────────

/**
 * Read a market's state from the contract.
 */
export async function getMarketOnChain(marketId: bigint) {
  const { publicClient } = getClients();
  const market = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "getMarket",
    args: [marketId],
  }) as any;

  return {
    id: Number(market.id),
    closesAt: Number(market.closesAt),
    entryPrice: Number(market.entryPrice) / 10 ** PRICE_DECIMALS,
    exitPrice: Number(market.exitPrice) / 10 ** PRICE_DECIMALS,
    longPool: formatUnits(market.longPool, USDC_DECIMALS),
    shortPool: formatUnits(market.shortPool, USDC_DECIMALS),
    status: ["open", "resolved", "cancelled"][Number(market.status)],
    winningSide: Number(market.winningSide) === 0 ? "long" : "short",
  };
}

/**
 * Get a user's vault balance (deposited USDC).
 */
export async function getUserBalance(userAddress: Address): Promise<string> {
  const { publicClient } = getClients();
  const balance = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "balances",
    args: [userAddress],
  }) as bigint;
  return formatUnits(balance, USDC_DECIMALS);
}

/**
 * Get a user's current nonce for EIP-712 bet signing.
 */
export async function getUserNonce(userAddress: Address): Promise<bigint> {
  const { publicClient } = getClients();
  return await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "nonces",
    args: [userAddress],
  }) as bigint;
}

/**
 * Accrue rewards (cashback/referral) to users from the on-chain reward reserve.
 * Called by the backend after calculating rewards off-chain post-resolution.
 */
export async function accrueRewardsOnChain(
  users: Address[],
  amounts: bigint[],
  marketId: bigint
): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "accrueRewards",
    args: [users, amounts, marketId],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Read a user's accrued (claimable) reward balance.
 */
export async function getUserRewardBalance(userAddress: Address): Promise<string> {
  const { publicClient } = getClients();
  const balance = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "rewardBalances",
    args: [userAddress],
  }) as bigint;
  return formatUnits(balance, USDC_DECIMALS);
}

/**
 * Read the total reward reserve in the contract.
 */
export async function getRewardReserve(): Promise<string> {
  const { publicClient } = getClients();
  const reserve = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi,
    functionName: "rewardReserve",
    args: [],
  }) as bigint;
  return formatUnits(reserve, USDC_DECIMALS);
}

// ─── Constants (for frontend EIP-712 domain) ─────────────────────────────────

export const VAULT_CONFIG = {
  address: VAULT_ADDRESS,
  chainId: CHAIN.id,
  name: "FUDVault",
  version: "1",
};
