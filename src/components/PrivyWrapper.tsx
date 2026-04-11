"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia, base } from "viem/chains";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export default function PrivyWrapper({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#22c55e", // emerald for Real mode
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia, base],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "all-users",
          },
        },
        loginMethods: ["email", "wallet", "google"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
