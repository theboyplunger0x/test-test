// GenLayer Price Oracle — dual network support
// Studionet: free, no gas — used for paper markets
// Bradbury testnet: uses GEN gas — used for testnet markets

import { createAccount, createClient } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORACLE_PATH = path.join(__dirname, "../intelligent-oracles/price_oracle.py");

// Two clients: studionet (free) and bradbury (GEN gas)
const _clients: Record<string, any> = {};

function getClient(network: "studionet" | "bradbury") {
  if (_clients[network]) return _clients[network];

  const privateKey = process.env.GENLAYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("GENLAYER_PRIVATE_KEY not set");

  const account = createAccount(`0x${privateKey.replace(/^0x/, "")}`);

  if (network === "studionet") {
    _clients[network] = createClient({
      chain: {
        ...studionet,
        rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
      },
      account,
    });
  } else {
    const rpcUrl = process.env.GENLAYER_RPC_URL ?? "https://rpc-bradbury.genlayer.com";
    _clients[network] = createClient({
      chain: {
        ...testnetBradbury,
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      account,
    });
  }

  return _clients[network];
}

/**
 * Ask GenLayer validators to reach consensus on the current price of a token.
 * @param network - "studionet" (paper, free) or "bradbury" (testnet, GEN gas)
 */
export async function getPriceFromGenLayer(symbol: string, chain: string, ca: string, network: "studionet" | "bradbury" = "bradbury"): Promise<number> {
  const client = getClient(network);
  const oracleCode = readFileSync(ORACLE_PATH, "utf-8");

  const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${ca}`;

  console.log(`[genlayer:${network}] Deploying price oracle for ${symbol}...`);
  const deployHash = await client.deployContract({
    code: oracleCode,
    args: [symbol, dexUrl],
    leaderOnly: false,
  });

  console.log(`[genlayer:${network}] Deploy TX: ${deployHash}`);
  const deployReceipt = await client.waitForTransactionReceipt({
    hash: deployHash,
    status: "FINALIZED",
    retries: 30,
    interval: 2000,
  });

  const oracleAddress = deployReceipt.data?.contract_address;
  if (!oracleAddress) throw new Error(`GenLayer deploy failed — no contract address`);

  const execResult = (deployReceipt as any).consensus_data?.leader_receipt?.[0]?.execution_result;
  if (execResult === "ERROR") throw new Error(`GenLayer deploy execution error`);

  console.log(`[genlayer:${network}] Contract deployed @ ${oracleAddress}`);

  console.log(`[genlayer:${network}] Calling resolve()...`);
  const resolveHash = await client.writeContract({
    address: oracleAddress,
    functionName: "resolve",
    args: [],
    leaderOnly: network === "studionet",
  });

  console.log(`[genlayer:${network}] Resolve TX: ${resolveHash}`);
  await client.waitForTransactionReceipt({
    hash: resolveHash,
    status: "FINALIZED",
    retries: 60,
    interval: 3000,
  });

  const result = await client.readContract({
    address: oracleAddress,
    functionName: "get_price",
    args: [],
  });

  const price = Number(result.price);
  if (!price || price <= 0) throw new Error(`GenLayer returned invalid price: ${result.price}`);

  console.log(`[genlayer:${network}] ${symbol} = $${price} (oracle @ ${oracleAddress})`);
  return price;
}

export function isGenLayerConfigured(): boolean {
  return !!process.env.GENLAYER_PRIVATE_KEY;
}
