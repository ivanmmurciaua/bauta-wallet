"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatUnits, parseUnits } from "viem";
import { WATCHER_URL } from "@/lib/constants";
import { useChain } from "@/contexts/ChainContext";

interface TokenBalance {
  token:     string;
  symbol:    string;
  decimals:  number;
  spendable: string;
  pending:   string;
}

type LoadStatus = "idle" | "loading" | "done" | "error";
type TxStatus   = "idle" | "pending" | "done" | "error";

export default function PrivateDashboard() {
  const { chainConfig } = useChain();
  const [watcherReady, setWatcherReady]         = useState(false);
  const [broadcasterReady, setBroadcasterReady] = useState(false);
  const [railgunAddress, setRailgunAddress]     = useState<string | null>(null);
  const [balances, setBalances]                 = useState<TokenBalance[]>([]);
  const [status, setStatus]                     = useState<LoadStatus>("idle");
  const [error, setError]                       = useState<string | null>(null);

  // Unshield state
  const [unshieldTo, setUnshieldTo]       = useState("");
  const [unshieldAmt, setUnshieldAmt]     = useState("");
  const [unshieldToken, setUnshieldToken] = useState("");
  const [unshieldStatus, setUnshieldStatus] = useState<TxStatus>("idle");
  const [unshieldTx, setUnshieldTx]       = useState<string | null>(null);
  const [unshieldErr, setUnshieldErr]     = useState<string | null>(null);

  // Private transfer state
  const [transferTo, setTransferTo]       = useState("");
  const [transferAmt, setTransferAmt]     = useState("");
  const [transferToken, setTransferToken] = useState("");
  const [transferStatus, setTransferStatus] = useState<TxStatus>("idle");
  const [transferTx, setTransferTx]       = useState<string | null>(null);
  const [transferErr, setTransferErr]     = useState<string | null>(null);

  // Reset all state when chain changes
  useEffect(() => {
    setBalances([]);
    setStatus("idle");
    setError(null);
    setUnshieldTo(""); setUnshieldAmt(""); setUnshieldToken("");
    setUnshieldStatus("idle"); setUnshieldTx(null); setUnshieldErr(null);
    setTransferTo(""); setTransferAmt(""); setTransferToken("");
    setTransferStatus("idle"); setTransferTx(null); setTransferErr(null);
  }, [chainConfig.chain.id]);

  useEffect(() => {
    fetch(`${WATCHER_URL}/ready`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.json())
      .then(d => {
        if (d.ready === true) {
          setWatcherReady(true);
          setRailgunAddress(d.railgunAddress ?? null);
        }
      })
      .catch(() => {});
    fetch(`${WATCHER_URL}/broadcaster`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.json())
      .then(d => { if (d.ready === true) setBroadcasterReady(true); })
      .catch(() => {});
  }, []);

  // Sync token selector when balances load
  useEffect(() => {
    if (balances.length > 0) {
      if (!unshieldToken) setUnshieldToken(balances[0].token);
      if (!transferToken) setTransferToken(balances[0].token);
    }
  }, [balances]);

  const handleRefresh = async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`${WATCHER_URL}/balance?chainId=${chainConfig.chain.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch balances");
      setBalances(data.balances ?? []);
      setStatus("done");
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? "Unknown error");
      setStatus("error");
    }
  };

  const handleUnshield = async () => {
    setUnshieldStatus("pending");
    setUnshieldTx(null);
    setUnshieldErr(null);
    const token = balances.find(b => b.token === unshieldToken);
    if (!token) return;
    try {
      const amount = parseUnits(unshieldAmt, token.decimals).toString();
      const res = await fetch(`${WATCHER_URL}/unshield`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toAddress: unshieldTo, amount, chainId: chainConfig.chain.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unshield failed");
      setUnshieldTx(data.txHash);
      setUnshieldStatus("done");
      setUnshieldTo("");
      setUnshieldAmt("");
    } catch (e: unknown) {
      setUnshieldErr((e as { message?: string })?.message ?? "Unknown error");
      setUnshieldStatus("error");
    }
  };

  const handleTransfer = async () => {
    setTransferStatus("pending");
    setTransferTx(null);
    setTransferErr(null);
    const token = balances.find(b => b.token === transferToken);
    if (!token) return;
    try {
      const amount = parseUnits(transferAmt, token.decimals).toString();
      const res = await fetch(`${WATCHER_URL}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toRailgunAddress: transferTo, tokenAddress: transferToken, amount, chainId: chainConfig.chain.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transfer failed");
      setTransferTx(data.txHash);
      setTransferStatus("done");
      setTransferTo("");
      setTransferAmt("");
    } catch (e: unknown) {
      setTransferErr((e as { message?: string })?.message ?? "Unknown error");
      setTransferStatus("error");
    }
  };

  const totalSpendable = balances.reduce((acc, b) =>
    acc + BigInt(b.spendable), 0n,
  );

  const monoLabel: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    padding: "8px 10px",
    outline: "none",
    boxSizing: "border-box",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
  };

  const btnPrimary = (disabled: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    background: disabled ? "var(--surface)" : "var(--green)",
    color: disabled ? "var(--text-muted)" : "#000",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--font-mono)",
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
  });

  return (
    <main className="page">
      {/* Header */}
      <div className="animate-fade-up page-col" style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Link href="/" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", textDecoration: "none", letterSpacing: "0.1em" }}>
            ← back
          </Link>
        </div>
        <h1 style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "clamp(20px, 4vw, 28px)", color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
          Private dashboard
          <span className="cursor-blink" />
        </h1>
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, fontWeight: 300 }}>
          Your RAILGUN shielded balance — private by default.
        </p>
      </div>

      {/* Balance Card */}
      <div className="animate-fade-up delay-1 page-col" style={{ border: "1px solid var(--border)" }}>
        {!watcherReady ? (
          <div style={{ padding: "var(--card-pad)" }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.8 }}>
              ✗ stealth-watcher offline
              <br />
              <span style={{ fontSize: 10 }}>// start the backend to access your private balance</span>
            </p>
          </div>
        ) : (
          <div style={{ padding: "var(--card-pad)" }}>
            {/* RAILGUN address */}
            {railgunAddress && (
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
                <p style={{ ...monoLabel, marginBottom: 4 }}>RAILGUN address</p>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green-dim)", wordBreak: "break-all", lineHeight: 1.6 }}>
                  {railgunAddress}
                </p>
              </div>
            )}

            {/* Refresh button */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <p style={monoLabel}>Shielded balance</p>
              <button
                onClick={handleRefresh}
                disabled={status === "loading"}
                style={btnPrimary(status === "loading")}
              >
                {status === "loading" ? "// scanning..." : status === "done" ? "↻ Refresh" : "Check balance →"}
              </button>
            </div>

            {status === "error" && error && (
              <div style={{ padding: "10px 12px", background: "#1a0505", border: "1px solid #3d0a0a", marginBottom: 16 }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--red)" }}>✗ {error}</p>
              </div>
            )}

            {status === "loading" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0" }}>
                <div style={{ width: 8, height: 8, border: "1.5px solid var(--border)", borderTop: "1.5px solid var(--green)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  // syncing with RAILGUN network...
                </p>
              </div>
            )}

            {status === "done" && (
              <>
                {balances.length === 0 ? (
                  <div style={{ padding: "20px 0", textAlign: "center" }}>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      // no shielded balance found
                    </p>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 6, opacity: 0.6 }}>
                      // shield funds from the dashboard to get started
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--green-muted)", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        Total spendable
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--green)", fontWeight: 700 }}>
                        {formatUnits(totalSpendable, 18)} ETH
                      </span>
                    </div>

                    {balances.map(b => {
                      const spendable = BigInt(b.spendable);
                      const pending   = BigInt(b.pending);
                      return (
                        <div key={b.token} style={{ padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)", fontWeight: 700 }}>
                              {b.symbol}
                            </p>
                            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all", maxWidth: "60%", textAlign: "right" }}>
                              {b.token}
                            </p>
                          </div>
                          <div style={{ display: "flex", gap: 24 }}>
                            <div>
                              <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
                                Spendable
                              </p>
                              <p style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: spendable > 0n ? "var(--green)" : "var(--text-muted)", fontWeight: 700 }}>
                                {formatUnits(spendable, b.decimals)}
                              </p>
                            </div>
                            {pending > 0n && (
                              <div>
                                <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
                                  Pending
                                </p>
                                <p style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#f0a000", fontWeight: 700 }}>
                                  {formatUnits(pending, b.decimals)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Unshield Card */}
      {watcherReady && status === "done" && balances.length > 0 && (
        <div className="animate-fade-up delay-2 page-col" style={{ border: "1px solid var(--border)", marginTop: 16 }}>
          <div style={{ padding: "var(--card-pad)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={monoLabel}>Unshield to public address</p>
              {broadcasterReady ? (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--green-dim)", letterSpacing: "0.08em" }}>● waku ready</span>
              ) : (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.08em" }}>○ waku offline</span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <p style={monoLabel}>Token</p>
                <select
                  value={unshieldToken}
                  onChange={e => setUnshieldToken(e.target.value)}
                  style={selectStyle}
                >
                  {balances.map(b => (
                    <option key={b.token} value={b.token}>{b.symbol} ({formatUnits(BigInt(b.spendable), b.decimals)} spendable)</option>
                  ))}
                </select>
              </div>
              <div>
                <p style={monoLabel}>To address (0x...)</p>
                <input
                  type="text"
                  value={unshieldTo}
                  onChange={e => setUnshieldTo(e.target.value)}
                  placeholder="0x..."
                  style={inputStyle}
                />
              </div>
              <div>
                <p style={monoLabel}>Amount</p>
                <input
                  type="text"
                  value={unshieldAmt}
                  onChange={e => setUnshieldAmt(e.target.value)}
                  placeholder="0.01"
                  style={inputStyle}
                />
              </div>

              {unshieldStatus === "error" && unshieldErr && (
                <div style={{ padding: "8px 10px", background: "#1a0505", border: "1px solid #3d0a0a" }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--red)" }}>✗ {unshieldErr}</p>
                </div>
              )}
              {unshieldStatus === "done" && unshieldTx && (
                <div style={{ padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--green-muted)" }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", marginBottom: 2 }}>TX HASH</p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green)", wordBreak: "break-all" }}>{unshieldTx}</p>
                </div>
              )}
              {unshieldStatus === "pending" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, border: "1.5px solid var(--border)", borderTop: "1.5px solid var(--green)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>// generating ZK proof + broadcasting...</p>
                </div>
              )}

              <button
                onClick={handleUnshield}
                disabled={!broadcasterReady || unshieldStatus === "pending" || !unshieldTo || !unshieldAmt}
                style={{ ...btnPrimary(!broadcasterReady || unshieldStatus === "pending" || !unshieldTo || !unshieldAmt), alignSelf: "flex-end" }}
              >
                {unshieldStatus === "pending" ? "// processing..." : "Unshield →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Private Transfer Card */}
      {watcherReady && status === "done" && balances.length > 0 && (
        <div className="animate-fade-up delay-2 page-col" style={{ border: "1px solid var(--border)", marginTop: 16 }}>
          <div style={{ padding: "var(--card-pad)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <p style={monoLabel}>Private transfer (RAILGUN → RAILGUN)</p>
              {broadcasterReady ? (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--green-dim)", letterSpacing: "0.08em" }}>● waku ready</span>
              ) : (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.08em" }}>○ waku offline</span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <p style={monoLabel}>Token</p>
                <select
                  value={transferToken}
                  onChange={e => setTransferToken(e.target.value)}
                  style={selectStyle}
                >
                  {balances.map(b => (
                    <option key={b.token} value={b.token}>{b.symbol} ({formatUnits(BigInt(b.spendable), b.decimals)} spendable)</option>
                  ))}
                </select>
              </div>
              <div>
                <p style={monoLabel}>To RAILGUN address (0zk...)</p>
                <input
                  type="text"
                  value={transferTo}
                  onChange={e => setTransferTo(e.target.value)}
                  placeholder="0zk..."
                  style={inputStyle}
                />
              </div>
              <div>
                <p style={monoLabel}>Amount</p>
                <input
                  type="text"
                  value={transferAmt}
                  onChange={e => setTransferAmt(e.target.value)}
                  placeholder="0.01"
                  style={inputStyle}
                />
              </div>

              {transferStatus === "error" && transferErr && (
                <div style={{ padding: "8px 10px", background: "#1a0505", border: "1px solid #3d0a0a" }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--red)" }}>✗ {transferErr}</p>
                </div>
              )}
              {transferStatus === "done" && transferTx && (
                <div style={{ padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--green-muted)" }}>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", marginBottom: 2 }}>TX HASH</p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green)", wordBreak: "break-all" }}>{transferTx}</p>
                </div>
              )}
              {transferStatus === "pending" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, border: "1.5px solid var(--border)", borderTop: "1.5px solid var(--green)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>// generating ZK proof + broadcasting...</p>
                </div>
              )}

              <button
                onClick={handleTransfer}
                disabled={!broadcasterReady || transferStatus === "pending" || !transferTo || !transferAmt}
                style={{ ...btnPrimary(!broadcasterReady || transferStatus === "pending" || !transferTo || !transferAmt), alignSelf: "flex-end" }}
              >
                {transferStatus === "pending" ? "// processing..." : "Transfer →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <div className="animate-fade-up delay-3" style={{ marginTop: 32, display: "flex", gap: 24, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.1em" }}>
        {[
          { href: "/dashboard", label: "dashboard →" },
          { href: "/lookup",    label: "lookup →" },
        ].map(({ href, label }) => (
          <Link key={href} href={href} style={{ color: "var(--text-muted)", textDecoration: "none" }}
            onMouseOver={e => (e.currentTarget.style.color = "var(--green-dim)")}
            onMouseOut={e  => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            {label}
          </Link>
        ))}
      </div>
    </main>
  );
}
