"use client";

import { useState } from "react";
import { useChain, SUPPORTED_CHAINS } from "@/contexts/ChainContext";
import { useAccount } from "wagmi";

export function ChainSelector() {
  const { chainConfig, setChainId } = useChain();
  const { chain: walletChain, isConnected } = useAccount();
  const [open, setOpen] = useState(false);

  if (!isConnected) return null;

  return (
    <div style={{ position: "fixed", top: 18, left: 20, zIndex: 100 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          cursor: "pointer",
          fontFamily: "var(--font-mono)", fontSize: 9,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: chainConfig.testnet ? "#f59e0b" : "var(--green)", flexShrink: 0, display: "inline-block" }} />
        {chainConfig.label}
        <span style={{ opacity: 0.5, fontSize: 8 }}>▾</span>
        {walletChain && walletChain.id !== chainConfig.chain.id && (
          <span style={{ color: "#f59e0b", fontSize: 8 }}>⚠ wallet:{walletChain.id}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "#0a0e12", border: "1px solid var(--border)",
          minWidth: 160, zIndex: 101,
        }}>
          {SUPPORTED_CHAINS.map(c => (
            <button
              key={c.chain.id}
              onClick={() => { setChainId(c.chain.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 12px",
                background: c.chain.id === chainConfig.chain.id ? "var(--surface)" : "transparent",
                border: "none", borderBottom: "1px solid var(--border)",
                cursor: "pointer", textAlign: "left",
                fontFamily: "var(--font-mono)", fontSize: 9,
                letterSpacing: "0.1em", textTransform: "uppercase",
                color: c.chain.id === chainConfig.chain.id ? "var(--green)" : "var(--text-secondary)",
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.testnet ? "#f59e0b" : "var(--green)", flexShrink: 0, display: "inline-block" }} />
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
