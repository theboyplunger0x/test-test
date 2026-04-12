"use client";

import { useState, useEffect, useCallback } from "react";
import { useSignTypedData, usePrivy, useWallets } from "@privy-io/react-auth";
import { api } from "@/lib/api";

interface VaultConfig {
  address: string;
  chainId: number;
  name: string;
  version: string;
  depositAddress?: string;
}

/**
 * Hook for interacting with the FUDVault on-chain contract.
 *
 * Uses Privy's native useSignTypedData for EIP-712 signing —
 * works with embedded wallets without MetaMask or popups.
 *
 * @param userWalletAddr — the user's Main Wallet from DB (for reading balance)
 */
export function useVault(userWalletAddr?: string | null) {
  const balanceAddr = userWalletAddr ?? null;

  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [vaultBalance, setVaultBalance] = useState<string>("0");
  const [rewardBalance, setRewardBalance] = useState<string>("0");
  const [nonce, setNonce] = useState<string>("0");

  // Privy hooks for signing
  const { ready: privyReady, authenticated } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { signTypedData } = useSignTypedData();

  // Find the embedded wallet
  const embeddedWallet = wallets.find(w => w.walletClientType === "privy") ?? null;
  const canSign = privyReady && walletsReady && authenticated && !!embeddedWallet;

  // Load vault config once
  useEffect(() => {
    api.vaultConfig().then(setConfig).catch(() => {});
  }, []);

  // Poll vault balance + reward balance using the user's Main Wallet.
  useEffect(() => {
    if (!balanceAddr) { setVaultBalance("0"); setRewardBalance("0"); return; }
    const load = () => {
      api.vaultBalance(balanceAddr).then(r => setVaultBalance(r.balance)).catch(() => {});
      api.vaultRewards(balanceAddr).then(r => setRewardBalance(r.rewards)).catch(() => {});
    };
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [balanceAddr]);

  // Fetch nonce when wallet changes
  useEffect(() => {
    if (!balanceAddr) { setNonce("0"); return; }
    api.vaultNonce(balanceAddr).then(r => setNonce(r.nonce)).catch(() => {});
  }, [balanceAddr]);

  /**
   * Sign a bet using Privy's native useSignTypedData.
   * Works with embedded wallets — no MetaMask, no popups, invisible to user.
   */
  const signBet = useCallback(async (
    marketId: number,
    side: "long" | "short",
    amountUsdc: number,
  ): Promise<string | null> => {
    const signerAddr = balanceAddr;
    if (!signerAddr || !config) {
      console.error("[vault] Cannot sign: no signer address or config");
      return null;
    }

    if (!canSign) {
      console.error("[vault] Cannot sign: Privy not ready or no embedded wallet", {
        privyReady, walletsReady, authenticated,
        embeddedWallet: !!embeddedWallet,
        walletTypes: wallets.map(w => w.walletClientType),
      });
      return null;
    }

    const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000)).toString();
    const sideEnum = side === "long" ? 0 : 1;

    const domain = {
      name: config.name,
      version: config.version,
      chainId: config.chainId,
      verifyingContract: config.address as `0x${string}`,
    };

    const types = {
      Bet: [
        { name: "marketId", type: "uint256" },
        { name: "user", type: "address" },
        { name: "side", type: "uint8" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };

    const message = {
      marketId: marketId,
      user: signerAddr as `0x${string}`,
      side: sideEnum,
      amount: amountRaw,
      nonce: nonce,
    };

    try {
      console.log("[vault] Signing bet with Privy embedded wallet...");
      const { signature } = await signTypedData({
        domain,
        types,
        primaryType: "Bet",
        message,
      }, {
        address: signerAddr,
      });

      // Increment local nonce optimistically
      setNonce(n => (BigInt(n) + BigInt(1)).toString());

      console.log("[vault] Signature obtained:", signature.slice(0, 20) + "...");
      return signature;
    } catch (e) {
      console.error("[vault] Privy signTypedData failed:", e);
      return null;
    }
  }, [balanceAddr, config, nonce, canSign, signTypedData, wallets]);

  const refreshBalance = useCallback(() => {
    const addr = balanceAddr;
    if (!addr) return;
    api.vaultBalance(addr).then(r => setVaultBalance(r.balance)).catch(() => {});
    api.vaultRewards(addr).then(r => setRewardBalance(r.rewards)).catch(() => {});
  }, [balanceAddr]);

  return {
    config,
    vaultBalance,
    rewardBalance,
    nonce,
    canSign,
    signBet,
    refreshBalance,
  };
}
