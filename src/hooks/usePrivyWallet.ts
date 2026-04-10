import { useState, useEffect, useCallback } from "react";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth";
import { api } from "@/lib/api";

/**
 * Centralized wallet state & actions for the Main Wallet architecture.
 *
 * Each FUD account has one Main Wallet (Privy embedded).
 * External wallets are NOT used as primary — only for login/funding.
 */
export function usePrivyWallet() {
  const { login: privyLogin, logout: privyLogout, authenticated: privyAuthenticated, user: privyUser, exportWallet: privyExportWallet, linkWallet: privyLinkWalletFn } = usePrivy();
  const { wallets: privyWallets } = useWallets();
  const { fundWallet: privyFundWallet } = useFundWallet();

  const [walletAddr, setWalletAddr] = useState<string | null>(null);

  // True iff the active walletAddr corresponds to a Privy embedded wallet.
  const isEmbeddedWallet =
    !!walletAddr && privyWallets.some(w => w.walletClientType === "privy" && w.address?.toLowerCase() === walletAddr.toLowerCase());

  // Privy wallet sync — always prefer embedded wallet as Main Wallet
  useEffect(() => {
    if (!privyAuthenticated || !privyUser) return;
    const embedded = privyWallets.find(w => w.walletClientType === "privy");
    if (embedded?.address) {
      setWalletAddr(embedded.address);
      api.linkWallet(embedded.address).catch(() => {});
    }
  }, [privyAuthenticated, privyUser, privyWallets]);

  // Actions
  const disconnect = useCallback(async () => {
    setWalletAddr(null);
  }, []);

  const fund = useCallback(() => {
    if (!walletAddr) return Promise.resolve();
    return privyFundWallet({ address: walletAddr }).catch(() => {});
  }, [walletAddr, privyFundWallet]);

  const exportKey = useCallback(() => {
    return privyExportWallet().catch(() => {});
  }, [privyExportWallet]);

  const linkAnother = useCallback(() => {
    privyLinkWalletFn();
  }, [privyLinkWalletFn]);

  const loginEmbedded = useCallback(() => {
    if (privyAuthenticated) return;
    privyLogin();
  }, [privyAuthenticated, privyLogin]);

  const logoutPrivy = useCallback(async () => {
    setWalletAddr(null);
    try { await privyLogout(); } catch {}
  }, [privyLogout]);

  /**
   * Get the Privy embedded wallet's ethereum provider for signing.
   * This is the Main Wallet provider — used for EIP-712 signatures.
   */
  const getEmbeddedProvider = useCallback(async () => {
    const embedded = privyWallets.find(w => w.walletClientType === "privy");
    if (!embedded) return null;
    return await embedded.getEthereumProvider();
  }, [privyWallets]);

  return {
    walletAddr,
    setWalletAddr,
    isEmbeddedWallet,
    privyAuthenticated,
    privyUser,
    disconnect,
    fund,
    exportKey,
    linkAnother,
    loginEmbedded,
    logoutPrivy,
    getEmbeddedProvider,
  };
}
