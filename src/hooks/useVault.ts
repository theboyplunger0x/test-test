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

  // Poll vault balance when wallet is connected
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

  return {
    config,
    vaultBalance,
    nonce,
    signBet,
  };
}
