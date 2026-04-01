"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  useAccount,
  useConnect,
  useSignMessage,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useBalance,
} from "wagmi";
import {
  deriveStealthKeys,
  SIGNING_MESSAGE,
  STEALTH_REGISTRY_ADDRESS,
  STEALTH_REGISTRY_ABI,
} from "@/lib/stealth";
import { derivePQKeys } from "@/lib/stealth-pq";
import { SCHEME_ID_CLASSIC, SCHEME_ID_PQ, WATCHER_URL } from "@/lib/constants";
import { toHex } from "viem";
import { usePQMode } from "@/hooks/usePQMode";
import { useChain } from "@/contexts/ChainContext";

type Step = "connect" | "sign" | "register" | "done";

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const { pqEnabled } = usePQMode();
  const { chainConfig } = useChain();

  const schemeId = pqEnabled ? SCHEME_ID_PQ : SCHEME_ID_CLASSIC;

  const [step, setStep] = useState<Step>("connect");
  const [metaAddress, setMetaAddress] = useState<`0x${string}` | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  // Stealth keys — kept in memory only, never persisted
  const [spendKey, setSpendKey] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [mlkemDecapsKey, setMlkemDecapsKey] = useState<string | null>(null); // hex, PQ only
  const [activeSchemeId, setActiveSchemeId] = useState<string>("2");

  // Auto-shield
  const [watcherReady, setWatcherReady] = useState(false);
  const [autoShield, setAutoShield] = useState(false);
  const [autoShieldPending, setAutoShieldPending] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    fetch(`${WATCHER_URL}/ready`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.json())
      .then((d) => {
        if (d.ready === true) {
          setWatcherReady(true);
        }
      })
      .catch(() => setWatcherReady(false));
  }, []);

  // Reset all key/auto-shield state when scheme changes, then re-check watcher
  useEffect(() => {
    setStep("connect");
    setMetaAddress(null);
    setError(null);
    setTxHash(undefined);
    setSpendKey(null);
    setViewKey(null);
    setMlkemDecapsKey(null);
    setAutoShield(false);
    setShowWarning(false);

    if (!watcherReady || !address) return;
    const scheme = pqEnabled
      ? SCHEME_ID_PQ.toString()
      : SCHEME_ID_CLASSIC.toString();
    fetch(`${WATCHER_URL}/registered?address=${address}&schemeId=${scheme}`, {
      signal: AbortSignal.timeout(2000),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.registered === true) setAutoShield(true);
      })
      .catch(() => {});
  }, [pqEnabled, watcherReady, address]);

  const { data: registered } = useReadContract({
    address: STEALTH_REGISTRY_ADDRESS,
    abi: STEALTH_REGISTRY_ABI,
    functionName: "stealthMetaAddressOf",
    args: [address ?? "0x0000000000000000000000000000000000000000", schemeId],
    chainId: chainConfig.chain.id,
    query: { enabled: isConnected && !!address },
  });
  const minLen = pqEnabled ? 2504 : 136; // hex chars: 1251*2+2 vs 67*2+2
  const isRegistered = ((registered as string)?.length ?? 0) >= minLen;

  const { isLoading: isMining, isSuccess: txConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const { data: balanceData, isLoading: balanceLoading } = useBalance({
    address,
    chainId: chainConfig.chain.id,
    query: { enabled: isConnected && !!address },
  });
  // block until balance is confirmed > 0 — disabled by default while loading or unknown
  const hasGas = !balanceLoading && balanceData !== undefined && (balanceData.value ?? 0n) > 0n;

  const handleSign = async () => {
    setSigning(true);
    setError(null);
    try {
      const sig = await signMessageAsync({ message: SIGNING_MESSAGE });
      if (pqEnabled) {
        const keys = await derivePQKeys(sig);
        setMetaAddress(keys.pqMetaAddress);
        setSpendKey(keys.spendingPrivateKey);
        setViewKey(keys.viewingPrivateKey);
        setMlkemDecapsKey(toHex(keys.mlkemDecapsKey));
        setActiveSchemeId(SCHEME_ID_PQ.toString());
      } else {
        const keys = await deriveStealthKeys(sig);
        setMetaAddress(keys.stealthMetaAddress);
        setSpendKey(keys.spendingPrivateKey);
        setViewKey(keys.viewingPrivateKey);
        setMlkemDecapsKey(null);
        setActiveSchemeId(SCHEME_ID_CLASSIC.toString());
      }
      if (!isRegistered) setStep("register");
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? "Signing failed");
    } finally {
      setSigning(false);
    }
  };

  const handleAutoShieldToggle = () => {
    if (autoShield) {
      setAutoShield(false);
      return;
    }
    setShowWarning(true);
  };

  const handleAutoShieldConfirm = async () => {
    setShowWarning(false);
    if (!address || !spendKey || !viewKey) return;
    setAutoShieldPending(true);
    try {
      const res = await fetch(`${WATCHER_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          viewKey,
          spendKey,
          schemeId: activeSchemeId,
          ...(mlkemDecapsKey ? { mlkemDecapsKey } : {}),
        }),
      });
      if (!res.ok) throw new Error("Backend registration failed");
      setAutoShield(true);
    } catch (e: unknown) {
      setError(
        (e as { message?: string })?.message ??
          "Auto-shield registration failed",
      );
    } finally {
      setAutoShieldPending(false);
    }
  };

  const handleRegister = async () => {
    if (!metaAddress) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: STEALTH_REGISTRY_ADDRESS,
        abi: STEALTH_REGISTRY_ABI,
        functionName: "registerKeys",
        args: [schemeId, metaAddress],
      });
      setTxHash(hash);
      setStep("done");
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? "Registration failed");
    }
  };

  return (
    <main className="page">
      {/* Header */}
      <div className="animate-fade-up page-col" style={{ marginBottom: 48 }}>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--text-muted)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          bauta.wallet
        </p>
        <h1
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: "clamp(22px, 4vw, 32px)",
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          Stealth addresses
          <span className="cursor-blink" />
        </h1>
        <p
          style={{
            marginTop: 12,
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.8,
            fontWeight: 300,
            maxWidth: "var(--text-width)",
          }}
        >
          Receive payments privately. Register your stealth meta-address so
          anyone can send you funds without linking transactions to your
          identity.
          {pqEnabled && (
            <span
              style={{
                display: "block",
                marginTop: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--green)",
                letterSpacing: "0.05em",
              }}
            >
              // Post-Quantum mode: ECDH + ML-KEM-768 hybrid
            </span>
          )}
        </p>
      </div>

      {/* Card */}
      <div
        className="animate-fade-up delay-1 page-col"
        style={{
          border: "1px solid var(--border)",
        }}
      >
        {!isConnected ? (
          /* ── Connect ── */
          <div style={{ padding: "var(--card-pad)" }}>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-secondary)",
                marginBottom: 16,
                lineHeight: 1.8,
              }}
            >
              {">"} Connect your wallet to register a stealth meta-address.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {connectors.map((c) => (
                <button
                  key={c.uid}
                  onClick={() => connect({ connector: c })}
                  disabled={isConnecting}
                  style={{
                    width: "100%",
                    padding: "12px 20px",
                    background: "var(--surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    textAlign: "left",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.borderColor = "var(--green)")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                >
                  → {c.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: "var(--card-pad)" }}>
            {/* Steps */}
            {isRegistered && step !== "done" ? (
              <div style={{ padding: "16px 0" }}>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    lineHeight: 1.8,
                    marginBottom: spendKey ? 0 : 16,
                  }}
                >
                  <span style={{ color: "var(--green-dim)" }}>
                    ✓ {pqEnabled ? "PQ" : "Classic"} meta-address live on-chain
                  </span>
                </p>
                {false && !spendKey && watcherReady && !autoShield && (
                  <button
                    onClick={handleSign}
                    disabled={signing}
                    style={{
                      width: "100%",
                      padding: "10px 20px",
                      background: signing ? "var(--surface)" : "transparent",
                      color: signing
                        ? "var(--text-muted)"
                        : "var(--text-secondary)",
                      border: "1px solid var(--border)",
                      cursor: signing ? "not-allowed" : "pointer",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      marginTop: 12,
                    }}
                    onMouseOver={(e) => {
                      if (!signing)
                        e.currentTarget.style.borderColor = "var(--green)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  >
                    {signing
                      ? "// signing..."
                      : "Derive keys for auto-shield →"}
                  </button>
                )}
              </div>
            ) : step === "connect" || step === "sign" ? (
              <div>
                {!hasGas && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "#1a0505",
                      border: "1px solid #3d0a0a",
                      marginBottom: 12,
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--red)",
                      }}
                    >
                      ✗ No ETH for gas on {chainConfig.label}
                    </p>
                  </div>
                )}
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    marginBottom: 16,
                    lineHeight: 1.8,
                  }}
                >
                  {">"} Sign a message to derive your stealth keys.
                  <br />
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    // No private key is ever exposed or transmitted.
                  </span>
                </p>
                <button
                  onClick={handleSign}
                  disabled={signing || !hasGas}
                  style={{
                    width: "100%",
                    padding: "12px 20px",
                    background:
                      signing || !hasGas ? "var(--surface)" : "var(--green)",
                    color: signing || !hasGas ? "var(--text-muted)" : "#000",
                    border: "none",
                    cursor: signing || !hasGas ? "not-allowed" : "pointer",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                  }}
                >
                  {signing ? "// signing..." : "Sign →"}
                </button>
              </div>
            ) : step === "register" ? (
              <div>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  Your stealth meta-address{" "}
                  {pqEnabled ? "(PQ · 1251 bytes)" : "(classic · 67 bytes)"}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--green-dim)",
                    wordBreak: "break-all",
                    lineHeight: 1.8,
                    padding: "10px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    marginBottom: 16,
                  }}
                >
                  {metaAddress}
                </p>
                {!hasGas && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "#1a0505",
                      border: "1px solid #3d0a0a",
                      marginBottom: 10,
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--red)",
                      }}
                    >
                      ✗ No ETH for gas on {chainConfig.label}
                    </p>
                  </div>
                )}
                <button
                  onClick={handleRegister}
                  disabled={!hasGas}
                  style={{
                    width: "100%",
                    padding: "12px 20px",
                    background: hasGas ? "var(--green)" : "var(--surface)",
                    color: hasGas ? "#000" : "var(--text-muted)",
                    border: "none",
                    cursor: hasGas ? "pointer" : "not-allowed",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                  }}
                >
                  Register on-chain →
                </button>
              </div>
            ) : (
              /* done */
              <div>
                {isMining ? (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        border: "1.5px solid var(--border)",
                        borderTop: "1.5px solid var(--green)",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                      }}
                    />
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      // confirming...
                    </p>
                  </div>
                ) : (
                  <div>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--green)",
                        marginBottom: 12,
                      }}
                    >
                      ✓ Registered successfully
                    </p>
                    {txHash && (
                      <a
                        href={`${chainConfig.explorer}/tx/${txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9,
                          color: "var(--text-secondary)",
                          wordBreak: "break-all",
                          textDecoration: "none",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {txHash}
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Auto-shield section — on hold (scanner disabled) */}
            {false && watcherReady && spendKey && viewKey && (
              <div
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--text-secondary)",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                      }}
                    >
                      Auto-shield
                    </p>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {watcherReady
                        ? "// stealth-watcher ready"
                        : "// stealth-watcher offline"}
                    </p>
                  </div>
                  <button
                    onClick={handleAutoShieldToggle}
                    disabled={!watcherReady || autoShieldPending}
                    style={{
                      padding: "6px 14px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      border: "1px solid",
                      cursor:
                        !watcherReady || autoShieldPending
                          ? "not-allowed"
                          : "pointer",
                      background: autoShield
                        ? "var(--green)"
                        : "var(--surface)",
                      color: autoShield ? "#000" : "var(--text-muted)",
                      borderColor: autoShield
                        ? "var(--green)"
                        : "var(--border)",
                    }}
                  >
                    {autoShieldPending ? "..." : autoShield ? "ON" : "OFF"}
                  </button>
                </div>

                {/* Warning modal */}
                {showWarning && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "12px 14px",
                      background: "#1a0e00",
                      border: "1px solid #4d2f00",
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "#f0a000",
                        marginBottom: 10,
                        lineHeight: 1.8,
                      }}
                    >
                      ⚠ You are about to share your private keys with your
                      local stealth-watcher backend.
                      <br />
                      <span style={{ color: "var(--text-muted)" }}>
                        The backend will be able to detect incoming payments and
                        move funds from your stealth addresses to RAILGUN
                        automatically.
                      </span>
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={handleAutoShieldConfirm}
                        style={{
                          flex: 1,
                          padding: "8px 0",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          background: "#f0a000",
                          color: "#000",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        I understand — enable
                      </button>
                      <button
                        onClick={() => setShowWarning(false)}
                        style={{
                          flex: 1,
                          padding: "8px 0",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          background: "var(--surface)",
                          color: "var(--text-muted)",
                          border: "1px solid var(--border)",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  background: "#1a0505",
                  border: "1px solid #3d0a0a",
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--red)",
                  }}
                >
                  ✗ {error}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Nav */}
      <div
        className="animate-fade-up delay-2"
        style={{
          marginTop: 32,
          display: "flex",
          gap: 24,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.1em",
        }}
      >
        {[
          { href: "/lookup", label: "lookup →" },
          { href: "/dashboard", label: "dashboard →" },
          ...(watcherReady ? [{ href: "/private", label: "private →" }] : []),
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            style={{ color: "var(--text-muted)", textDecoration: "none" }}
            onMouseOver={(e) =>
              (e.currentTarget.style.color = "var(--green-dim)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.color = "var(--text-muted)")
            }
          >
            {label}
          </Link>
        ))}
      </div>
    </main>
  );
}
