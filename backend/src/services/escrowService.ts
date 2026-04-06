// Escrow Service — deploys and interacts with BettingEscrow contracts on GenLayer Bradbury
//
// Flow:
// 1. Party A calls createBet → deploys escrow contract with their GEN deposit
// 2. Party B calls takeBet → sends GEN to the contract
// 3. After timeframe, backend calls resolve → oracle consensus → winner gets paid on-chain

import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ESCROW_PATH = path.join(__dirname, "../intelligent-oracles/betting_escrow.py");

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
      ...testnetBradbury,
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    account,
  });

  return _client;
}

/**
 * Deploy a new BettingEscrow contract.
 * Party A's deposit is sent as `value` in the deploy tx.
 */
export async function deployEscrow(params: {
  symbol: string;
  dexUrl: string;
  timeframe: string;
  entryPrice: string;
  sideA: "long" | "short";
  partyA: string;       // wallet address
  depositA: bigint;     // GEN in wei
}): Promise<{ contractAddress: string; deployHash: string }> {
  const client = getClient();
  const escrowCode = readFileSync(ESCROW_PATH, "utf-8");

  console.log(`[escrow] Deploying BettingEscrow for ${params.symbol} (${params.sideA} by ${params.partyA.slice(0, 10)}...)...`);

  const deployHash = await client.deployContract({
    code: escrowCode,
    args: [
      params.symbol,
      params.dexUrl,
      params.timeframe,
      params.entryPrice,
      params.sideA,
      params.partyA,
    ],
    value: params.depositA,
    leaderOnly: false,
  });

  console.log(`[escrow] Deploy TX: ${deployHash}`);

  const receipt = await client.waitForTransactionReceipt({
    hash: deployHash,
    status: "ACCEPTED",
    retries: 30,
    interval: 2000,
  });

  console.log(`[escrow] Receipt:`, JSON.stringify(receipt, null, 2));
  const contractAddress = receipt.data?.contract_address ?? (receipt as any).contract_address ?? (receipt as any).contractAddress;
  if (!contractAddress) throw new Error(`Escrow deploy failed — no contract address. Receipt keys: ${Object.keys(receipt ?? {}).join(", ")}`);

  console.log(`[escrow] Contract deployed @ ${contractAddress}`);
  return { contractAddress, deployHash };
}

/**
 * Party B takes the bet — sends GEN to the escrow contract.
 */
export async function takeBet(contractAddress: string, depositB: bigint): Promise<string> {
  const client = getClient();

  console.log(`[escrow] Taking bet on ${contractAddress}...`);

  const hash = await client.writeContract({
    address: contractAddress,
    functionName: "take_bet",
    args: [],
    value: depositB,
    leaderOnly: false,
  });

  console.log(`[escrow] Take bet TX: ${hash}`);

  await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    retries: 30,
    interval: 2000,
  });

  return hash;
}

/**
 * Resolve the escrow — triggers oracle consensus and pays winner on-chain.
 */
export async function resolveEscrow(contractAddress: string): Promise<{
  exitPrice: string;
  winner: string;
  winnerSide: string;
  status: string;
}> {
  const client = getClient();

  console.log(`[escrow] Resolving ${contractAddress}...`);

  const hash = await client.writeContract({
    address: contractAddress,
    functionName: "resolve",
    args: [],
    value: BigInt(0),
    leaderOnly: false,
  });

  console.log(`[escrow] Resolve TX: ${hash}`);

  await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    retries: 60,
    interval: 3000,
  });

  // Read final state
  const state = await client.readContract({
    address: contractAddress,
    functionName: "get_state",
    args: [],
  });

  console.log(`[escrow] Resolved: ${state.winner_side} wins @ $${state.exit_price}`);
  return {
    exitPrice: state.exit_price,
    winner: state.winner,
    winnerSide: state.winner_side,
    status: state.status,
  };
}

/**
 * Read escrow contract state.
 */
export async function getEscrowState(contractAddress: string): Promise<Record<string, unknown>> {
  const client = getClient();
  return await client.readContract({
    address: contractAddress,
    functionName: "get_state",
    args: [],
  });
}

/**
 * Cancel escrow (only party A, only while waiting).
 */
export async function cancelEscrow(contractAddress: string): Promise<string> {
  const client = getClient();

  const hash = await client.writeContract({
    address: contractAddress,
    functionName: "cancel",
    args: [],
    value: BigInt(0),
    leaderOnly: false,
  });

  await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    retries: 30,
    interval: 2000,
  });

  console.log(`[escrow] Cancelled ${contractAddress}`);
  return hash;
}
