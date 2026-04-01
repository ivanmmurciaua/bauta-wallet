"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { useSwitchChain, useAccount } from "wagmi";
import { SUPPORTED_CHAINS, CHAIN_BY_ID, DEFAULT_CHAIN_ID, type ChainConfig } from "@/lib/constants";

const STORAGE_KEY = "bauta-chain-id";

interface ChainContextType {
  chainConfig: ChainConfig;
  setChainId:  (id: number) => void;
}

const defaultConfig = CHAIN_BY_ID[DEFAULT_CHAIN_ID];

const ChainContext = createContext<ChainContextType>({
  chainConfig: defaultConfig,
  setChainId:  () => {},
});

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [chainId, setChainIdState] = useState<number>(DEFAULT_CHAIN_ID);
  const { switchChain } = useSwitchChain();
  const { chain: walletChain } = useAccount();

  // Sync context with wallet's actual chain
  useEffect(() => {
    if (walletChain && CHAIN_BY_ID[walletChain.id]) {
      setChainIdState(walletChain.id);
      try { localStorage.setItem(STORAGE_KEY, String(walletChain.id)); } catch { /* SSR */ }
    }
  }, [walletChain]);

  // Restore from localStorage on mount (before wallet connects)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && CHAIN_BY_ID[Number(stored)]) {
        setChainIdState(Number(stored));
      }
    } catch { /* SSR */ }
  }, []);

  const setChainId = (id: number) => {
    if (!CHAIN_BY_ID[id]) return;
    switchChain({ chainId: id });
  };

  return (
    <ChainContext.Provider value={{ chainConfig: CHAIN_BY_ID[chainId] ?? defaultConfig, setChainId }}>
      {children}
    </ChainContext.Provider>
  );
}

export function useChain() {
  return useContext(ChainContext);
}

export { SUPPORTED_CHAINS };
