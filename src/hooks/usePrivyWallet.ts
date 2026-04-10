import { useState, useEffect, useCallback } from "react";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth";
import { api } from "@/lib/api";
import { connectWallet as connectMetaMask, getConnectedWallet, getGENBalance, onAccountsChanged } from "@/lib/wallet";

/**
 * Centralized wallet state & actions.
 *
 * Handles:
 * - Privy embedded / external wallet detection and syncing
 * - Direct MetaMask connection (legacy path, still supported)
 * - GEN balance polling for testnet
 * - Backend wallet linking (idempotent)
 * - Actions: fund, export, link another, disconnect
 */
export function usePrivyWallet(opts: { autoDetect?: boolean } = {}) {
  const { autoDetect = false } = opts;

  const { login: privyLogin, logout: privyLogout, authenticated: privyAuthenticated, user: privyUser, exportWallet: privyExportWallet, linkWallet: privyLinkWalletFn } = usePrivy();
  const { wallets: privyWallets } = useWallets();
  const { fundWallet: privyFundWallet } = useFundWallet();

  const [walletAddr, setWalletAddr] = useState<string | null>(null);
  const [genBalance, setGenBalance] = useState<number>(0);

  // True iff the active walletAddr corresponds to a Privy embedded wallet.
  // External (MetaMask) wallets, including ones linked via Privy, are NOT
  // embedded — they live in the user's browser/extension and can be revoked
  // permission-by-permission.
  const isEmbeddedWallet =
    !!walletAddr && privyWallets.some(w => w.walletClientType === "privy" && w.address?.toLowerCase() === walletAddr.toLowerCase());

  // Auto-detect already connected MetaMask wallet (testnet mode legacy path)
  useEffect(() => {
    if (!autoDetect) return;
    getConnectedWallet().then(addr => {
      if (addr) {
        setWalletAddr(addr);
        getGENBalance(addr).then(setGenBalance);
      }
    });
    const unsub = onAccountsChanged((accounts) => {
      const addr = accounts[0] ?? null;
      setWalletAddr(addr);
      if (addr) getGENBalance(addr).then(setGenBalance);
      else setGenBalance(0);
    });
    return unsub;
  }, [autoDetect]);

  // Refresh GEN balance periodically when a wallet is connected
  useEffect(() => {
    if (!walletAddr) return;
    const iv = setInterval(() => getGENBalance(walletAddr).then(setGenBalance), 15000);
    return () => clearInterval(iv);
  }, [walletAddr]);

  // Privy wallet — sync with walletAddr when user is logged in via Privy
  useEffect(() => {
    if (!privyAuthenticated || !privyUser) return;
    // Prefer external wallet, fallback to embedded
    const external = privyWallets.find(w => w.walletClientType !== "privy");
    const embedded = privyWallets.find(w => w.walletClientType === "privy");
    const primary = external ?? embedded;
    if (primary?.address) {
      setWalletAddr(primary.address);
      getGENBalance(primary.address).then(setGenBalance);
      api.linkWallet(primary.address).catch(() => {});
    }
  }, [privyAuthenticated, privyUser, privyWallets]);

  // Actions
  const connect = useCallback(async () => {
    const addr = await connectMetaMask();
    setWalletAddr(addr);
    getGENBalance(addr).then(setGenBalance);
    api.linkWallet(addr).catch(() => {});
    return addr;
  }, []);

  const disconnect = useCallback(async () => {
    setWalletAddr(null);
    setGenBalance(0);
    try {
      await window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {}
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

  /**
   * Trigger Privy login flow — opens the Privy modal where the user can pick
   * email / social / wallet. On success, the embedded wallet is created (or
   * recovered) and synced into `walletAddr` via the privyAuthenticated effect.
   *
   * Used by the "Use embedded wallet" CTA in ConnectWalletModal.
   */
  const loginEmbedded = useCallback(() => {
    if (privyAuthenticated) {
      // Already in Privy — embedded should be on its way; nothing to do.
      return;
    }
    privyLogin();
  }, [privyAuthenticated, privyLogin]);

  const logoutPrivy = useCallback(async () => {
    setWalletAddr(null);
    setGenBalance(0);
    try { await privyLogout(); } catch {}
  }, [privyLogout]);

  return {
    walletAddr,
    setWalletAddr,
    genBalance,
    isEmbeddedWallet,
    privyAuthenticated,
    privyUser,
    connect,
    disconnect,
    fund,
    exportKey,
    linkAnother,
    loginEmbedded,
    logoutPrivy,
  };
}
