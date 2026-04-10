"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

/**
 * Vault config from backend — describes the FUDVault contract on-chain.
 * Used to build EIP-712 domain for bet signing.
 */
interface VaultConfig {
  address: string;
  chainId: number;
  name: string;
  version: string;
}

/**
 * Hook for interacting with the FUDVault on-chain contract.
 *
 * Provides:
 * - Vault config (address, chainId, EIP-712 domain)
 * - On-chain USDC balance in the vault
 * - Nonce for EIP-712 signing
 * - signBet() — prompts the user's wallet to sign an EIP-712 bet message
 *
 * The actual deposit/withdraw is done directly by the user calling the
 * contract from their wallet (via Privy or MetaMask). This hook only
 * handles the read operations and bet signing.
 */
export function useVault(walletAddr: string | null) {
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [vaultBalance, setVaultBalance] = useState<string>("0");
  const [nonce, setNonce] = useState<string>("0");

  // Load vault config once
  useEffect(() => {
    api.vaultConfig().then(setConfig).catch(() => {});
  }, []);

  // Poll vault balance when wallet is connected.
  // Don't reset to "0" on error — keep the last known value to avoid flashing.
  useEffect(() => {
    if (!walletAddr) { setVaultBalance("0"); return; }
    const load = () => api.vaultBalance(walletAddr).then(r => setVaultBalance(r.balance)).catch(() => {});
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [walletAddr]);

  // Fetch nonce when wallet changes
  useEffect(() => {
    if (!walletAddr) { setNonce("0"); return; }
    api.vaultNonce(walletAddr).then(r => setNonce(r.nonce)).catch(() => {});
  }, [walletAddr]);

  /**
   * Sign a bet using EIP-712 via the user's connected wallet.
   * Returns the signature hex string, or null if the user rejected.
   *
   * The signed message is then sent to POST /markets/:id/bet along with
   * the `signature` and `wallet_address` fields.
   */
  const signBet = useCallback(async (
    marketId: number,
    side: "long" | "short",
    amountUsdc: number,
  ): Promise<string | null> => {
    if (!walletAddr || !config) return null;

    const ethereum = (window as any).ethereum;
    if (!ethereum) return null;

    await ensureBaseSepoliaChain(ethereum);

    const domain = {
      name: config.name,
      version: config.version,
      chainId: config.chainId,
      verifyingContract: config.address,
    };

    const types = {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Bet: [
        { name: "marketId", type: "uint256" },
        { name: "user", type: "address" },
        { name: "side", type: "uint8" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };

    // USDC has 6 decimals
    const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000)).toString();
    const sideEnum = side === "long" ? 0 : 1;

    const message = {
      marketId: marketId.toString(),
      user: walletAddr,
      side: sideEnum.toString(),
      amount: amountRaw,
      nonce: nonce,
    };

    try {
      const msgParams = JSON.stringify({
        types,
        primaryType: "Bet",
        domain,
        message,
      });

      const signature: string = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [walletAddr, msgParams],
      });

      // Increment local nonce optimistically
      setNonce(n => (BigInt(n) + BigInt(1)).toString());

      return signature;
    } catch {
      // User rejected or wallet error
      return null;
    }
  }, [walletAddr, config, nonce]);

  // USDC contract address on Base Sepolia
  const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  // Base Sepolia chainId
  const BASE_SEPOLIA_CHAIN_ID = 84532;

  // ERC-20 ABI fragments for approve + deposit + withdraw
  const ERC20_APPROVE_ABI = "function approve(address spender, uint256 amount) returns (bool)";
  const VAULT_DEPOSIT_ABI = "function deposit(uint256 amount)";
  const VAULT_WITHDRAW_ABI = "function withdraw(uint256 amount)";

  /** Ensure the wallet is on Base Sepolia before sending a tx. */
  async function ensureBaseSepoliaChain(ethereum: any) {
    const chainIdHex = await ethereum.request({ method: "eth_chainId" });
    const currentChain = parseInt(chainIdHex, 16);
    if (currentChain === BASE_SEPOLIA_CHAIN_ID) return;
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + BASE_SEPOLIA_CHAIN_ID.toString(16) }],
      });
    } catch (switchError: any) {
      // Chain not added — add it
      if (switchError.code === 4902) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x" + BASE_SEPOLIA_CHAIN_ID.toString(16),
            chainName: "Base Sepolia",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://sepolia.base.org"],
            blockExplorerUrls: ["https://sepolia.basescan.org"],
          }],
        });
      } else {
        throw switchError;
      }
    }
  }

  /**
   * Deposit USDC into the FUDVault contract.
   * Steps: approve USDC → call vault.deposit().
   * Both txs prompted to the user's wallet.
   */
  const depositToVault = useCallback(async (amountUsdc: number) => {
    if (!walletAddr || !config) throw new Error("Wallet or vault not ready");
    const ethereum = (window as any).ethereum;
    if (!ethereum) throw new Error("No wallet found");

    await ensureBaseSepoliaChain(ethereum);

    const amountRaw = "0x" + BigInt(Math.round(amountUsdc * 1_000_000)).toString(16);

    // 1. Approve USDC spend
    const iface = new (await import("ethers")).Interface([ERC20_APPROVE_ABI]);
    const approveData = iface.encodeFunctionData("approve", [config.address, amountRaw]);
    await ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddr,
        to: USDC_ADDRESS,
        data: approveData,
      }],
    });

    // Small delay to let the approval propagate
    await new Promise(r => setTimeout(r, 2000));

    // 2. Deposit to vault
    const vaultIface = new (await import("ethers")).Interface([VAULT_DEPOSIT_ABI]);
    const depositData = vaultIface.encodeFunctionData("deposit", [amountRaw]);
    await ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddr,
        to: config.address,
        data: depositData,
      }],
    });

    // Refresh balance after a short delay
    setTimeout(() => {
      if (walletAddr) api.vaultBalance(walletAddr).then(r => setVaultBalance(r.balance)).catch(() => {});
    }, 5000);
  }, [walletAddr, config]);

  /**
   * Withdraw USDC from the FUDVault contract back to wallet.
   */
  const withdrawFromVault = useCallback(async (amountUsdc: number) => {
    if (!walletAddr || !config) throw new Error("Wallet or vault not ready");
    const ethereum = (window as any).ethereum;
    if (!ethereum) throw new Error("No wallet found");

    await ensureBaseSepoliaChain(ethereum);

    const amountRaw = "0x" + BigInt(Math.round(amountUsdc * 1_000_000)).toString(16);

    const vaultIface = new (await import("ethers")).Interface([VAULT_WITHDRAW_ABI]);
    const withdrawData = vaultIface.encodeFunctionData("withdraw", [amountRaw]);
    await ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddr,
        to: config.address,
        data: withdrawData,
      }],
    });

    setTimeout(() => {
      if (walletAddr) api.vaultBalance(walletAddr).then(r => setVaultBalance(r.balance)).catch(() => {});
    }, 5000);
  }, [walletAddr, config]);

  const refreshBalance = useCallback(() => {
    if (walletAddr) api.vaultBalance(walletAddr).then(r => setVaultBalance(r.balance)).catch(() => {});
  }, [walletAddr]);

  return {
    config,
    vaultBalance,
    nonce,
    signBet,
    depositToVault,
    withdrawFromVault,
    refreshBalance,
  };
}
