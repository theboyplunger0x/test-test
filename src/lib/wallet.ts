// MetaMask wallet connection + GenLayer client for Bradbury testnet
// Users sign transactions directly from MetaMask — fully trustless

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const BRADBURY = {
  chainId: "0x107D", // 4221
  chainName: "GenLayer Testnet Bradbury",
  rpcUrls: ["https://rpc-bradbury.genlayer.com"],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  blockExplorerUrls: ["https://explorer-bradbury.genlayer.com"],
};

const ESCROW_CODE_URL = "/api/escrow-code"; // served from backend or static

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener: (event: string, cb: (...args: unknown[]) => void) => void;
    };
  }
}

export function isMetaMaskInstalled(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function connectWallet(): Promise<string> {
  if (!window.ethereum) throw new Error("MetaMask not installed");

  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];

  // Switch to Bradbury network (add it if not present)
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BRADBURY.chainId }],
    });
  } catch (e: unknown) {
    if ((e as { code: number }).code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [BRADBURY],
      });
    } else {
      throw e;
    }
  }

  return accounts[0];
}

/**
 * Read GEN balance from Bradbury chain for a given address.
 */
export async function getGENBalance(address: string): Promise<number> {
  if (!window.ethereum) return 0;
  try {
    const balanceHex = (await window.ethereum.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    })) as string;
    return parseInt(balanceHex, 16) / 1e18;
  } catch {
    return 0;
  }
}

/**
 * Check if wallet is already connected (without prompting).
 */
export async function getConnectedWallet(): Promise<string | null> {
  if (!window.ethereum) return null;
  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

export function onAccountsChanged(cb: (accounts: string[]) => void): () => void {
  if (!window.ethereum) return () => {};
  const handler = (...args: unknown[]) => cb(args[0] as string[]);
  window.ethereum.on("accountsChanged", handler);
  return () => window.ethereum?.removeListener("accountsChanged", handler);
}

// ── GenLayer Client (browser, MetaMask-signed) ───────────────────────────────

let _glClient: ReturnType<typeof createClient> | null = null;
let _glClientAddr: string | null = null;

export async function getGenLayerClient(walletAddress: string) {
  if (_glClient && _glClientAddr === walletAddress) return _glClient;

  _glClient = createClient({
    chain: testnetBradbury,
    account: walletAddress as `0x${string}`,
  });

  // Switch MetaMask to Bradbury network via SDK
  await (_glClient as any).connect("testnetBradbury");

  _glClientAddr = walletAddress;
  return _glClient;
}

export function resetGenLayerClient() {
  _glClient = null;
}

// ── On-chain betting operations ──────────────────────────────────────────────

const ESCROW_CODE = `# { "Depends": "py-genlayer:latest" }
from genlayer import *

class BettingEscrow(gl.Contract):
    symbol: str
    dex_url: str
    timeframe: str
    entry_price: str
    side_a: str
    party_a: Address
    party_b: Address
    deposit_a: u256
    deposit_b: u256
    status: str
    exit_price: str
    winner: Address
    winner_side: str

    def __init__(self, symbol: str, dex_url: str, timeframe: str, entry_price: str, side_a: str, party_a: Address):
        self.symbol = symbol
        self.dex_url = dex_url
        self.timeframe = timeframe
        self.entry_price = entry_price
        self.side_a = side_a
        self.party_a = party_a
        self.party_b = Address("0x0000000000000000000000000000000000000000")
        self.deposit_a = gl.message.value
        self.deposit_b = u256(0)
        self.status = "waiting"
        self.exit_price = "0"
        self.winner = Address("0x0000000000000000000000000000000000000000")
        self.winner_side = ""

    @gl.public.write
    def take_bet(self):
        assert self.status == "waiting", "Bet is not open"
        assert gl.message.value > u256(0), "Must send GEN"
        self.party_b = gl.message.sender_address
        self.deposit_b = gl.message.value
        self.status = "active"

    @gl.public.write
    def resolve(self):
        assert self.status == "active", "Bet is not active"
        def fetch_and_parse():
            response = gl.nondet.web.get(self.dex_url)
            body = response.body.decode("utf-8")
            prompt = f"Find the priceUsd for {self.symbol} from this DexScreener data: {body[:2000]}. Pick the pair with highest liquidity. Return ONLY the price number."
            return gl.nondet.exec_prompt(prompt)
        price_str = gl.eq_principle.prompt_comparative(fetch_and_parse, principle="The price number must be exactly the same")
        self.exit_price = price_str.strip()
        entry = float(self.entry_price)
        exit_p = float(self.exit_price)
        if exit_p == entry:
            self.status = "cancelled"
            gl.get_contract_at(self.party_a).emit_transfer(value=self.deposit_a)
            gl.get_contract_at(self.party_b).emit_transfer(value=self.deposit_b)
            return
        price_went_up = exit_p > entry
        if (self.side_a == "long" and price_went_up) or (self.side_a == "short" and not price_went_up):
            self.winner = self.party_a
            self.winner_side = self.side_a
        else:
            self.winner = self.party_b
            self.winner_side = "short" if self.side_a == "long" else "long"
        total = u256(int(self.deposit_a) + int(self.deposit_b))
        gl.get_contract_at(self.winner).emit_transfer(value=total)
        self.status = "resolved"

    @gl.public.write
    def cancel(self):
        assert self.status == "waiting", "Can only cancel while waiting"
        assert gl.message.sender_address == self.party_a, "Only party A can cancel"
        gl.get_contract_at(self.party_a).emit_transfer(value=self.deposit_a)
        self.status = "cancelled"

    @gl.public.view
    def get_state(self) -> dict:
        return {
            "symbol": self.symbol, "timeframe": self.timeframe,
            "entry_price": self.entry_price, "exit_price": self.exit_price,
            "side_a": self.side_a,
            "party_a": str(self.party_a), "party_b": str(self.party_b),
            "deposit_a": int(self.deposit_a), "deposit_b": int(self.deposit_b),
            "status": self.status,
            "winner": str(self.winner), "winner_side": self.winner_side,
            "balance": int(self.balance),
        }
`;

/**
 * Deploy a BettingEscrow contract — user signs with MetaMask.
 * Returns the contract address after deployment is finalized.
 */
export async function deployBetOnChain(params: {
  walletAddress: string;
  symbol: string;
  ca: string;
  timeframe: string;
  entryPrice: string;
  side: "long" | "short";
  amountGEN: number;
}): Promise<{ contractAddress: string; deployHash: string }> {
  const client = await getGenLayerClient(params.walletAddress);
  const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${params.ca}`;
  const valueWei = BigInt(Math.floor(params.amountGEN * 1e18));

  console.log(`[wallet] Deploying escrow for ${params.symbol}... (MetaMask will prompt)`);

  const deployHash = await (client as any).deployContract({
    code: ESCROW_CODE,
    args: [params.symbol, dexUrl, params.timeframe, params.entryPrice, params.side, params.walletAddress],
    value: valueWei,
    leaderOnly: false,
  });

  console.log(`[wallet] Deploy TX: ${deployHash}`);

  const receipt = await (client as any).waitForTransactionReceipt({
    hash: deployHash,
    status: "ACCEPTED",
    retries: 60,
    interval: 3000,
  });

  const contractAddress = receipt.data?.contract_address;
  if (!contractAddress) throw new Error("Deploy failed — no contract address");

  console.log(`[wallet] Escrow deployed @ ${contractAddress}`);
  return { contractAddress, deployHash };
}

/**
 * Take the other side of a bet — user sends GEN to the escrow contract.
 */
export async function takeBetOnChain(params: {
  walletAddress: string;
  contractAddress: string;
  amountGEN: number;
}): Promise<string> {
  const client = await getGenLayerClient(params.walletAddress);
  const valueWei = BigInt(Math.floor(params.amountGEN * 1e18));

  console.log(`[wallet] Taking bet on ${params.contractAddress}... (MetaMask will prompt)`);

  const hash = await (client as any).writeContract({
    address: params.contractAddress,
    functionName: "take_bet",
    args: [],
    value: valueWei,
    leaderOnly: false,
  });

  console.log(`[wallet] Take bet TX: ${hash}`);

  await (client as any).waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    retries: 30,
    interval: 2000,
  });

  return hash;
}

/**
 * Read escrow state from chain.
 */
export async function readEscrowState(walletAddress: string, contractAddress: string): Promise<Record<string, unknown>> {
  const client = await getGenLayerClient(walletAddress);
  return await (client as any).readContract({
    address: contractAddress,
    functionName: "get_state",
    args: [],
  });
}
