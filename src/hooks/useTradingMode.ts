/**
 * Trading mode — v1 mainnet: always Real mode.
 * Paper and Testnet modes removed for mainnet launch.
 * Type kept for compatibility with existing components.
 */
export type TradingMode = "paper" | "real" | "testnet";

export function useTradingMode() {
  // v1 mainnet: always Real. No toggle, no paper, no testnet.
  return {
    tradingMode: "real" as TradingMode,
    setTradingMode: (_mode: TradingMode) => {}, // no-op
    paperMode: false,
    isTestnet: false,
    isReal: true,
  };
}
