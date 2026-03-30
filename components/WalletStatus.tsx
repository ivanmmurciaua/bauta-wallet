"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletStatus() {
  const { address, isConnected, isConnecting } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);

  if (isConnecting) {
    return (
      <div style={containerStyle}>
        <span style={{ ...dotStyle, background: "var(--amber)" }} />
        <span style={labelStyle}>connecting...</span>
      </div>
    );
  }

  if (isConnected && address) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* Address — click to copy */}
        <button
          onClick={() => {
            navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copy address"
          style={{ ...containerStyle, cursor: "pointer", background: "#001a0a", borderColor: "var(--green-muted)" }}
        >
          <span style={{ ...dotStyle, background: "var(--green)" }} />
          <span style={{ ...labelStyle, color: copied ? "var(--green)" : "var(--green-dim)", transition: "color 0.15s" }}>
            {copied ? "copied!" : `${address.slice(0, 6)}…${address.slice(-4)}`}
          </span>
        </button>

        {/* Disconnect */}
        <button
          onClick={() => disconnect()}
          title="Disconnect"
          style={{ ...containerStyle, cursor: "pointer", padding: "5px 7px" }}
          onMouseOver={e => (e.currentTarget.style.borderColor = "var(--red)")}
          onMouseOut={e  => (e.currentTarget.style.borderColor = "var(--border)")}
        >
          ✕
        </button>
      </div>
    );
  }

  // Not connected — show first available connector as quick-connect
  const connector = connectors[0];
  if (!connector) return null;

  return (
    <button
      onClick={() => connect({ connector })}
      title={`Connect with ${connector.name}`}
      style={{ ...containerStyle, cursor: "pointer" }}
      onMouseOver={e => (e.currentTarget.style.borderColor = "var(--green-muted)")}
      onMouseOut={e  => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <span style={{ ...dotStyle, background: "var(--border)" }} />
      <span style={labelStyle}>no wallet</span>
    </button>
  );
}

const containerStyle: React.CSSProperties = {
  position: "fixed",
  top: 18,
  left: 20,
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "5px 10px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "var(--text-muted)",
  transition: "all 0.15s ease",
};

const dotStyle: React.CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  transition: "color 0.15s",
};
