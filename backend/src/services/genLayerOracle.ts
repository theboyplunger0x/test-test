// GenLayer Price Oracle
// Deploys a Python intelligent contract to GenLayer — validators reach consensus
// on the token price from DexScreener before returning it to us.
// Falls back to direct DexScreener if GenLayer is not configured.

import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORACLE_PATH = path.join(__dirname, "../intelligent-oracles/price_oracle.py");

let _client: any = null;

function getClient() {
  if (_client) return _client;

  const rpcUrl    = process.env.GENLAYER_RPC_URL;
  const privateKey = process.env.GENLAYER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    throw new Error("GENLAYER_RPC_URL and GENLAYER_PRIVATE_KEY not set");
  }

  const account = createAccount(`0x${privateKey.replace(/^0x/, "")}`);
  _client = createClient({
    chain: {
      ...studionet,
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    account,
  });

  return _client;
}

/**
 * Ask GenLayer validators to reach consensus on the current price of a token.
 * Uses DexScreener — covers all meme coins and DEX pairs.
 * Timeout: ~60s (30 retries × 2s interval).
 */
export async function getPriceFromGenLayer(symbol: string, chain: string, ca?: string | null): Promise<number> {
  const client = getClient();
  const oracleCode = readFileSync(ORACLE_PATH, "utf-8");

  // Build DexScreener URL — use CA for exact match, symbol search as fallback
  const dexUrl = ca
    ? `https://api.dexscreener.com/latest/dex/tokens/${ca}`
    : `https://api.dexscreener.com/latest/dex/search?q=${symbol}`;

  // Step 1: Deploy the oracle contract (symbol + url)
  console.log(`[genlayer] Deploying price oracle for ${symbol} (${ca ? 'CA' : 'search'})...`);
  const deployHash = await client.deployContract({
    code: oracleCode,
    args: [symbol, dexUrl],
    leaderOnly: false,
  });

  console.log(`[genlayer] Deploy TX: ${deployHash}`);
  const deployReceipt = await client.waitForTransactionReceipt({
    hash: deployHash,
    status: "FINALIZED",
    retries: 30,
    interval: 2000,
  });

  const oracleAddress = deployReceipt.data?.contract_address;
  if (!oracleAddress) throw new Error(`GenLayer deploy failed — no contract address`);

  // Check if deploy execution succeeded
  const execResult = (deployReceipt as any).consensus_data?.leader_receipt?.[0]?.execution_result;
  if (execResult === "ERROR") throw new Error(`GenLayer deploy execution error`);

  console.log(`[genlayer] Contract deployed @ ${oracleAddress}`);

  // Step 2: Call resolve() to fetch price via DexScreener + LLM consensus
  console.log(`[genlayer] Calling resolve()...`);
  const resolveHash = await client.writeContract({
    address: oracleAddress,
    functionName: "resolve",
    args: [],
    leaderOnly: true, // leader-only for speed on studionet
  });

  console.log(`[genlayer] Resolve TX: ${resolveHash}`);
  await client.waitForTransactionReceipt({
    hash: resolveHash,
    status: "FINALIZED",
    retries: 60,
    interval: 3000,
  });

  // Step 3: Read the resolved price
  const result = await client.readContract({
    address: oracleAddress,
    functionName: "get_price",
    args: [],
  });

  const price = Number(result.price);
  if (!price || price <= 0) throw new Error(`GenLayer returned invalid price: ${result.price}`);

  console.log(`[genlayer] ${symbol} = $${price} (oracle @ ${oracleAddress})`);
  return price;
}

/**
 * Returns true if GenLayer is configured in env vars.
 */
export function isGenLayerConfigured(): boolean {
  return !!(process.env.GENLAYER_RPC_URL && process.env.GENLAYER_PRIVATE_KEY);
}
