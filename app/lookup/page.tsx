"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { isAddress, getAddress, parseEther, concat, toHex } from "viem";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import {
  generateStealthAddress,
  parseMetaAddress,
  truncateKey,
  STEALTH_REGISTRY_ADDRESS,
  STEALTH_REGISTRY_ABI,
} from "@/lib/stealth";
import { generatePQStealthAddress, parsePQMetaAddress } from "@/lib/stealth-pq";
import {
  STEALTH_ANNOUNCER_ADDRESS,
  STEALTH_ANNOUNCER_ABI,
  SCHEME_ID_CLASSIC,
  SCHEME_ID_PQ,
} from "@/lib/constants";
import { usePQMode } from "@/hooks/usePQMode";
import { useChain } from "@/contexts/ChainContext";

type ClassicResult = {
  kind: "classic";
  stealthAddress: string;
  ephemeralPubkey: string;
  viewTag: number;
};
type PQResult = {
  kind: "pq";
  stealthAddress: string;
  ephemeralPubkey: string;
  kemCiphertext: string;
  viewTag: number;
};
type LookupResult = ClassicResult | PQResult;

export default function LookupPage() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { pqEnabled } = usePQMode();
  const { chainConfig } = useChain();
  const publicClient = usePublicClient({ chainId: chainConfig.chain.id });

  const schemeId = pqEnabled ? SCHEME_ID_PQ : SCHEME_ID_CLASSIC;

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTx, setSentTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setSentTx(null);
    setError(null);
  }, [pqEnabled]);

  const recipientValid = isAddress(recipient.trim());
  const amountValid = (() => {
    try {
      parseEther(amount);
      return parseFloat(amount) > 0;
    } catch {
      return false;
    }
  })();

  const handleLookup = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSentTx(null);
    try {
      const client = publicClient!;
      const raw = await client.readContract({
        address: STEALTH_REGISTRY_ADDRESS,
        abi: STEALTH_REGISTRY_ABI,
        functionName: "stealthMetaAddressOf",
        args: [getAddress(recipient.trim()), schemeId],
      });

      if (pqEnabled) {
        // PQ: expect 1251-byte meta-address (2504 hex chars + "0x")
        if (!raw || (raw as string).length < 2504)
          throw new Error("Address not registered in PQ mode");
        const { spendingPublicKey, viewingPublicKey, mlkemEncapsKey } =
          parsePQMetaAddress(raw as `0x${string}`);
        const res = await generatePQStealthAddress(
          `0x${Buffer.from(spendingPublicKey).toString("hex")}`,
          `0x${Buffer.from(viewingPublicKey).toString("hex")}`,
          mlkemEncapsKey,
        );
        setResult({ kind: "pq", ...res });
      } else {
        // Classic: expect 67-byte meta-address (136 hex chars + "0x")
        if (!raw || (raw as string).length < 136)
          throw new Error("Address not registered");
        const { spendingPublicKey, viewingPublicKey } = parseMetaAddress(
          raw as `0x${string}`,
        );
        const res = await generateStealthAddress(
          `0x${Buffer.from(spendingPublicKey).toString("hex")}`,
          `0x${Buffer.from(viewingPublicKey).toString("hex")}`,
        );
        setResult({ kind: "classic", ...res });
      }
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!result) return;
    setSending(true);
    setError(null);
    try {
      // 1. Send ETH to stealth address
      const sendHash = await sendTransactionAsync({
        to: result.stealthAddress as `0x${string}`,
        value: parseEther(amount),
      });

      // 2. Build metadata and ephemeralPubKey for announcement
      let ephemeralPubKeyBytes: `0x${string}`;
      let metadata: `0x${string}`;

      if (result.kind === "pq") {
        // metadata = viewTag(1b) + kemCiphertext(1088b)
        const viewTagByte = new Uint8Array([result.viewTag]);
        const kemBytes = Buffer.from(result.kemCiphertext.slice(2), "hex");
        metadata = toHex(concat([viewTagByte, kemBytes])) as `0x${string}`;
        ephemeralPubKeyBytes = result.ephemeralPubkey as `0x${string}`;
      } else {
        // metadata = viewTag(1b)
        metadata =
          `0x${result.viewTag.toString(16).padStart(2, "0")}` as `0x${string}`;
        ephemeralPubKeyBytes = result.ephemeralPubkey as `0x${string}`;
      }

      // 3. Announce on-chain
      await writeContractAsync({
        address: STEALTH_ANNOUNCER_ADDRESS,
        abi: STEALTH_ANNOUNCER_ABI,
        functionName: "announce",
        args: [
          schemeId,
          result.stealthAddress as `0x${string}`,
          ephemeralPubKeyBytes,
          metadata,
        ],
      });

      setSentTx(sendHash);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="page">
      {/* Header */}
      <div className="animate-fade-up page-col" style={{ marginBottom: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-muted)",
              textDecoration: "none",
              letterSpacing: "0.1em",
            }}
          >
            ← back
          </Link>
        </div>
        <h1
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: "clamp(20px, 4vw, 28px)",
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          Send privately
          <span className="cursor-blink" />
        </h1>
        <p
          style={{
            marginTop: 10,
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.7,
            fontWeight: 300,
          }}
        >
          Generate a one-time stealth address for any registered recipient.
          {pqEnabled && (
            <span
              style={{
                display: "block",
                marginTop: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--green)",
                letterSpacing: "0.05em",
              }}
            >
              // Post-Quantum mode: hybrid ECDH + ML-KEM-768
            </span>
          )}
        </p>
      </div>

      <div
        className="animate-fade-up page-col"
        style={{
          marginBottom: 16,
          padding: "10px 14px",
          background: "rgba(99,102,241,0.06)",
          border: "1px solid rgba(99,102,241,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-muted)",
            lineHeight: 1.7,
          }}
        >
          This lookup works ONLY with the selected network. Want to send
          cross-chain? Scan all chains at once →
        </p>
        <a
          href={
            process.env.NEXT_PUBLIC_BAUTA_LOOKUP_URL ??
            "https://bautawallet.com/lookup"
          }
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--green)",
            textDecoration: "none",
            border: "1px solid var(--green-dim)",
            padding: "5px 12px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          bauta lookup
        </a>
      </div>

      <div
        className="animate-fade-up delay-1 page-col"
        style={{
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ padding: "var(--card-pad)" }}>
          {/* Recipient */}
          <div style={{ marginBottom: 12 }}>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              Recipient address
            </p>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              // placeholder="address"
              spellCheck={false}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#0a0e12",
                border: `1px solid ${recipientValid ? "var(--green-dim)" : "var(--border)"}`,
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                outline: "none",
              }}
            />
          </div>

          <button
            onClick={handleLookup}
            disabled={!recipientValid || loading}
            style={{
              width: "100%",
              padding: "11px 20px",
              marginBottom: 16,
              background:
                recipientValid && !loading ? "var(--green)" : "var(--surface)",
              color: recipientValid && !loading ? "#000" : "var(--text-muted)",
              border: "none",
              cursor: recipientValid && !loading ? "pointer" : "not-allowed",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            {loading ? "// generating..." : "Generate stealth address →"}
          </button>

          {error && (
            <div
              style={{
                padding: "10px 12px",
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
                ✗ {error}
              </p>
            </div>
          )}

          {/* Result */}
          {result && !sentTx && (
            <div
              style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}
            >
              <div style={{ marginBottom: 12 }}>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 4,
                  }}
                >
                  Stealth address
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--green)",
                    wordBreak: "break-all",
                  }}
                >
                  {result.stealthAddress}
                </p>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                <div>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      color: "var(--text-muted)",
                      letterSpacing: "0.1em",
                      marginBottom: 2,
                    }}
                  >
                    VIEW TAG
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-secondary)",
                    }}
                  >
                    0x{result.viewTag.toString(16).padStart(2, "0")}
                  </p>
                </div>
                <div>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      color: "var(--text-muted)",
                      letterSpacing: "0.1em",
                      marginBottom: 2,
                    }}
                  >
                    EPHEMERAL KEY
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {truncateKey(result.ephemeralPubkey, 6)}
                  </p>
                </div>
                {result.kind === "pq" && (
                  <div>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9,
                        color: "var(--text-muted)",
                        letterSpacing: "0.1em",
                        marginBottom: 2,
                      }}
                    >
                      KEM CT
                    </p>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--green-dim)",
                      }}
                    >
                      {truncateKey(result.kemCiphertext, 6)}
                    </p>
                  </div>
                )}
              </div>

              {/* Send */}
              {!isConnected ? (
                <div>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-muted)",
                      marginBottom: 10,
                    }}
                  >
                    // connect wallet to send
                  </p>
                  {connectors.map((c) => (
                    <button
                      key={c.uid}
                      onClick={() => connect({ connector: c })}
                      disabled={isConnecting}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "var(--surface)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border)",
                        cursor: "pointer",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        textAlign: "left",
                      }}
                    >
                      → {c.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Amount (ETH)"
                    style={{
                      flex: 1,
                      padding: "9px 12px",
                      background: "#0a0e12",
                      border: `1px solid ${amountValid ? "var(--green-dim)" : "var(--border)"}`,
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!amountValid || sending}
                    style={{
                      padding: "9px 18px",
                      flexShrink: 0,
                      background:
                        amountValid && !sending
                          ? "var(--green)"
                          : "var(--surface)",
                      color:
                        amountValid && !sending ? "#000" : "var(--text-muted)",
                      border: "none",
                      cursor:
                        amountValid && !sending ? "pointer" : "not-allowed",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {sending ? "..." : "Send"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Success */}
          {sentTx && (
            <div
              style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}
            >
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--green)",
                  marginBottom: 8,
                }}
              >
                ✓ Sent & announced
              </p>
              <a
                href={`${chainConfig.explorer}/tx/${sentTx}`}
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
                {sentTx}
              </a>
            </div>
          )}
        </div>
      </div>

      <div
        className="animate-fade-up delay-2"
        style={{
          marginTop: 32,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.1em",
        }}
      >
        ERC-5564 · {chainConfig.label.toUpperCase()}
      </div>
    </main>
  );
}
