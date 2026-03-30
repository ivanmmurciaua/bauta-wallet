"use client";

import { createContext, useContext, useState, useEffect } from "react";
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
  useEffect(() => {
    // Restore from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && CHAIN_BY_ID[Number(stored)]) {
        setChainIdState(Number(stored));
      }
    } catch { /* SSR */ }

    // Listen directly to MetaMask chainChanged event
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = (window as any).ethereum;
    if (!eth) return;
    const handler = (chainIdHex: string) => {
      const id = parseInt(chainIdHex, 16);
      if (CHAIN_BY_ID[id]) {
        setChainIdState(id);
        try { localStorage.setItem(STORAGE_KEY, String(id)); } catch { /* SSR */ }
      }
    };
    eth.on("chainChanged", handler);
    return () => eth.removeListener("chainChanged", handler);
  }, []);

  const setChainId = (id: number) => {
    if (!CHAIN_BY_ID[id]) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = (window as any).ethereum;
    if (eth) {
      eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${id.toString(16)}` }],
      }).catch(() => {/* user rejected or chain not added */});
    }
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
