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
export async function getPriceFromGenLayer(symbol: string, chain: string): Promise<number> {
  const client = getClient();
  const oracleCode = readFileSync(ORACLE_PATH, "utf-8");

  console.log(`[genlayer] Deploying price oracle for ${symbol}/${chain}...`);

  const hash = await client.deployContract({
    code: oracleCode,
    args: [symbol, chain],
    leaderOnly: false,   // all validators must agree
  });

  console.log(`[genlayer] TX: ${hash} — awaiting consensus...`);

  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    retries: 30,
    interval: 2000,
  });

  const oracleAddress = receipt.data?.contract_address;
  if (!oracleAddress) {
    throw new Error(`GenLayer oracle failed — no contract address in receipt`);
  }

  const result = await client.readContract({
    address: oracleAddress,
    functionName: "get_price",
    args: [],
  });

  const price = Number(result.price_usd);
  if (!price || price <= 0) throw new Error(`GenLayer returned invalid price: ${result.price_usd}`);

  console.log(`[genlayer] ${symbol} = $${price} (consensus @ ${oracleAddress})`);
  return price;
}

/**
 * Returns true if GenLayer is configured in env vars.
 */
export function isGenLayerConfigured(): boolean {
  return !!(process.env.GENLAYER_RPC_URL && process.env.GENLAYER_PRIVATE_KEY);
}
