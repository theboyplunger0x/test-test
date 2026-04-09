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

  const { logout: privyLogout, authenticated: privyAuthenticated, user: privyUser, exportWallet: privyExportWallet, linkWallet: privyLinkWalletFn } = usePrivy();
  const { wallets: privyWallets } = useWallets();
  const { fundWallet: privyFundWallet } = useFundWallet();

  const [walletAddr, setWalletAddr] = useState<string | null>(null);
  const [genBalance, setGenBalance] = useState<number>(0);

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

  const logoutPrivy = useCallback(async () => {
    setWalletAddr(null);
    setGenBalance(0);
    try { await privyLogout(); } catch {}
  }, [privyLogout]);

  return {
    walletAddr,
    setWalletAddr,
    genBalance,
    privyAuthenticated,
    privyUser,
    connect,
    disconnect,
    fund,
    exportKey,
    linkAnother,
    logoutPrivy,
  };
}
