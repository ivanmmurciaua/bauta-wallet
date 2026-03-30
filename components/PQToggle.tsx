"use client";

import { usePQMode } from "@/contexts/PQModeContext";

export function PQToggle() {
  const { pqEnabled, toggle } = usePQMode();

  return (
    <button
      onClick={toggle}
      title={pqEnabled ? "Post-Quantum mode ON — click to disable" : "Post-Quantum mode OFF — click to enable"}
      style={{
        position: "fixed",
        top: 18,
        right: 20,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        background: pqEnabled ? "#001a0a" : "var(--surface)",
        border: `1px solid ${pqEnabled ? "var(--green)" : "var(--border)"}`,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: pqEnabled ? "var(--green)" : "var(--text-muted)",
        transition: "all 0.15s ease",
      }}
    >
      <span style={{
        display: "inline-block",
        width: 6, height: 6,
        borderRadius: "50%",
        background: pqEnabled ? "var(--green)" : "var(--border)",
        flexShrink: 0,
      }} />
      {pqEnabled ? "PQS mode ON" : "PQS mode OFF"}
    </button>
  );
}
