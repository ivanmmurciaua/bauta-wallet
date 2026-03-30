"use client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { PQModeProvider } from "@/contexts/PQModeContext";
import { ChainProvider } from "@/contexts/ChainContext";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ChainProvider>
          <PQModeProvider>{children}</PQModeProvider>
        </ChainProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
