// MetaMask wallet connection for GenLayer Bradbury testnet

const BRADBURY = {
  chainId: "0x107D", // 4221
  chainName: "GenLayer Testnet Bradbury",
  rpcUrls: ["https://rpc-bradbury.genlayer.com"],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  blockExplorerUrls: ["https://explorer-bradbury.genlayer.com"],
};

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

export function onAccountsChanged(cb: (accounts: string[]) => void): () => void {
  if (!window.ethereum) return () => {};
  const handler = (...args: unknown[]) => cb(args[0] as string[]);
  window.ethereum.on("accountsChanged", handler);
  return () => window.ethereum?.removeListener("accountsChanged", handler);
}
