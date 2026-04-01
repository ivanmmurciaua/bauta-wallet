"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  createWalletClient,
  custom,
  formatEther,
  isAddress,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount, useConnect, useSignMessage, useReadContract, useConnectorClient } from "wagmi";
import { publicActions } from "viem";
import {
  deriveStealthKeys,
  checkAnnouncement,
  truncateKey,
  SIGNING_MESSAGE,
  STEALTH_REGISTRY_ADDRESS,
  STEALTH_REGISTRY_ABI,
} from "@/lib/stealth";
import {
  derivePQKeys,
  parsePQMetaAddress,
  checkPQAnnouncement,
} from "@/lib/stealth-pq";
import {
  STEALTH_ANNOUNCER_ADDRESS,
  ANNOUNCEMENT_SCAN_BLOCKS,
  SCHEME_ID_CLASSIC,
  SCHEME_ID_PQ,
  MIN_STEALTH_BALANCE,
  WATCHER_URL,
} from "@/lib/constants";
import { usePQMode } from "@/hooks/usePQMode";
import { useChain } from "@/contexts/ChainContext";

const ANNOUNCER_ABI = [
  {
    type: "event",
    name: "Announcement",
    inputs: [
      { name: "schemeId", type: "uint256", indexed: true },
      { name: "stealthAddress", type: "address", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "ephemeralPubKey", type: "bytes", indexed: false },
      { name: "metadata", type: "bytes", indexed: false },
    ],
  },
] as const;

interface StealthHit {
  stealthAddress: `0x${string}`;
  spendingKey: `0x${string}`;
  viewTag: number;
  balance: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

type ScanStatus = "idle" | "scanning" | "done" | "error";
type WithdrawStatus = "idle" | "sending" | "done" | "error";
type ShieldStatus = "idle" | "sending" | "done" | "error";

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { pqEnabled } = usePQMode();
  const { chainConfig } = useChain();
  const { data: connectorClient } = useConnectorClient({ chainId: chainConfig.chain.id });
  const walletPublicClient = connectorClient?.extend(publicActions);

  const schemeId = pqEnabled ? SCHEME_ID_PQ : SCHEME_ID_CLASSIC;

  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [progress, setProgress] = useState("");
  const [hits, setHits] = useState<StealthHit[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    setScanStatus("idle");
    setHits([]);
    setScanError(null);
    setProgress("");
  }, [pqEnabled]);

  const { data: registeredMeta } = useReadContract({
    address: STEALTH_REGISTRY_ADDRESS,
    abi: STEALTH_REGISTRY_ABI,
    functionName: "stealthMetaAddressOf",
    args: [address ?? "0x0000000000000000000000000000000000000000", schemeId],
    query: { enabled: isConnected && !!address },
  });
  const minLen = pqEnabled ? 2504 : 136;
  const isRegistered = ((registeredMeta as string)?.length ?? 0) >= minLen;

  // ── Watcher ready ────────────────────────────────────────────────────────────
  const [watcherReady, setWatcherReady] = useState(false);
  useEffect(() => {
    fetch(`${WATCHER_URL}/ready`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.json())
      .then(d => setWatcherReady(d.ready === true))
      .catch(() => {});
  }, []);

  // ── Withdraw state ───────────────────────────────────────────────────────────
  const [withdrawDest, setWithdrawDest] = useState<Record<string, string>>({});
  const [withdrawStatus, setWithdrawStatus] = useState<Record<string, WithdrawStatus>>({});
  const [withdrawTxHash, setWithdrawTxHash] = useState<Record<string, `0x${string}`>>({});
  const [withdrawError, setWithdrawError] = useState<Record<string, string>>({});

  // ── Shield state ─────────────────────────────────────────────────────────────
  const [shieldStatus, setShieldStatus] = useState<Record<string, ShieldStatus>>({});
  const [shieldTxHash, setShieldTxHash] = useState<Record<string, string>>({});
  const [shieldError, setShieldError] = useState<Record<string, string>>({});

  // ── Scan ─────────────────────────────────────────────────────────────────────
  const handleScan = async () => {
    if (!address) return;
    setScanStatus("scanning");
    setScanError(null);
    setHits([]);

    try {
      setProgress("Requesting wallet signature...");
      const sig = await signMessageAsync({ message: SIGNING_MESSAGE });

      let viewingPrivateKey: `0x${string}`;
      let spendingPrivateKey: `0x${string}`;
      let mlkemDecapsKey: Uint8Array | null = null;

      if (pqEnabled) {
        const pqKeys = await derivePQKeys(sig);
        viewingPrivateKey = pqKeys.viewingPrivateKey;
        spendingPrivateKey = pqKeys.spendingPrivateKey;
        mlkemDecapsKey = pqKeys.mlkemDecapsKey;
      } else {
        const keys = await deriveStealthKeys(sig);
        viewingPrivateKey = keys.viewingPrivateKey;
        spendingPrivateKey = keys.spendingPrivateKey;
      }

      const client = walletPublicClient!;
      const latestBlock = await client.getBlockNumber();
      const fromBlock =
        latestBlock > ANNOUNCEMENT_SCAN_BLOCKS
          ? latestBlock - ANNOUNCEMENT_SCAN_BLOCKS
          : 0n;

      const CHUNK = 1000n;
      const allLogs = [];
      for (let from = fromBlock; from <= latestBlock; from += CHUNK) {
        const to =
          from + CHUNK - 1n < latestBlock ? from + CHUNK - 1n : latestBlock;
        setProgress(`Fetching blocks ${from}–${to} / ${latestBlock}...`);
        const chunk = await client.getLogs({
          address: STEALTH_ANNOUNCER_ADDRESS,
          event: ANNOUNCER_ABI[0],
          args: { schemeId },
          fromBlock: from,
          toBlock: to,
        });
        allLogs.push(...chunk);
      }

      setProgress(`Checking ${allLogs.length} announcements...`);
      const foundMap = new Map<string, StealthHit>();

      for (let i = 0; i < allLogs.length; i++) {
        const log = allLogs[i];
        if (i % 50 === 0) {
          setProgress(`Checking ${i + 1} / ${allLogs.length}...`);
          await new Promise((r) => setTimeout(r, 0));
        }

        const ephemeralPubkey = log.args.ephemeralPubKey as `0x${string}`;
        const stealthAddress = log.args.stealthAddress as `0x${string}`;
        const metadata = log.args.metadata as `0x${string}`;
        const announcedViewTag = parseInt(metadata.slice(2, 4), 16);

        if (foundMap.has(stealthAddress)) continue;

        let result = null;
        try {
          if (pqEnabled && mlkemDecapsKey) {
            // metadata = viewTag(1b) + kemCiphertext(1088b)
            // hex: 2 chars "0x" + 2 chars viewTag + 2176 chars ct = at least 2180
            if (metadata.length < 2180) continue;
            const kemCiphertext = `0x${metadata.slice(4)}` as `0x${string}`;
            result = await checkPQAnnouncement(
              viewingPrivateKey,
              spendingPrivateKey,
              mlkemDecapsKey,
              ephemeralPubkey,
              kemCiphertext,
              stealthAddress,
              announcedViewTag,
            );
          } else {
            result = await checkAnnouncement(
              viewingPrivateKey,
              spendingPrivateKey,
              ephemeralPubkey,
              stealthAddress,
              announcedViewTag,
            );
          }
        } catch {
          continue;
        }

        if (result) {
          const balance = await client.getBalance({ address: stealthAddress });
          if (balance < MIN_STEALTH_BALANCE) continue;
          foundMap.set(stealthAddress, {
            stealthAddress,
            spendingKey: result.spendingKey,
            viewTag: result.viewTag,
            balance,
            txHash: log.transactionHash as `0x${string}`,
            blockNumber: log.blockNumber ?? 0n,
          });
          setHits([...foundMap.values()]);
        }
      }

      setProgress(
        `Done. Found ${foundMap.size} stealth address${foundMap.size !== 1 ? "es" : ""}.`,
      );
      setScanStatus("done");
    } catch (e: unknown) {
      setScanError((e as { message?: string })?.message ?? "Scan failed");
      setScanStatus("error");
    }
  };

  // ── Withdraw ─────────────────────────────────────────────────────────────────
  const handleWithdraw = async (hit: StealthHit) => {
    const dest = withdrawDest[hit.stealthAddress]?.trim();
    if (!dest || !isAddress(dest)) return;

    setWithdrawStatus((s) => ({ ...s, [hit.stealthAddress]: "sending" }));
    setWithdrawError((s) => ({ ...s, [hit.stealthAddress]: "" }));

    try {
      const account = privateKeyToAccount(hit.spendingKey);
      const publicClient = walletPublicClient!;
      const walletClient = createWalletClient({
        account,
        chain: chainConfig.chain,
        transport: custom(connectorClient!.transport),
      });

      const { maxFeePerGas } = await publicClient.estimateFeesPerGas();
      const gasEstimate = await publicClient.estimateGas({
        account,
        to: getAddress(dest) as `0x${string}`,
        value: 0n,
      });
      const gasCost = gasEstimate * (maxFeePerGas ?? 0n);
      const value = hit.balance - gasCost;
      if (value <= 0n) throw new Error("Balance too low to cover gas");

      const txHash = await walletClient.sendTransaction({
        to: getAddress(dest) as `0x${string}`,
        value,
        gas: gasEstimate,
      });

      setWithdrawTxHash((s) => ({ ...s, [hit.stealthAddress]: txHash }));
      setWithdrawStatus((s) => ({ ...s, [hit.stealthAddress]: "done" }));
      setHits((prev) =>
        prev.map((h) =>
          h.stealthAddress === hit.stealthAddress ? { ...h, balance: 0n } : h,
        ),
      );
    } catch (e: unknown) {
      setWithdrawError((s) => ({
        ...s,
        [hit.stealthAddress]: (e as { message?: string })?.message ?? "Failed",
      }));
      setWithdrawStatus((s) => ({ ...s, [hit.stealthAddress]: "error" }));
    }
  };

  // ── Shield ───────────────────────────────────────────────────────────────────
  const handleShield = async (hit: StealthHit) => {
    setShieldStatus(s => ({ ...s, [hit.stealthAddress]: "sending" }));
    setShieldError(s => ({ ...s, [hit.stealthAddress]: "" }));
    try {
      const res = await fetch(`${WATCHER_URL}/shield`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stealthAddress: hit.stealthAddress,
          stealthPrivKey: hit.spendingKey,
          amount: hit.balance.toString(),
          chainId: chainConfig.chain.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Shield failed");
      setShieldTxHash(s => ({ ...s, [hit.stealthAddress]: data.txHash }));
      setShieldStatus(s => ({ ...s, [hit.stealthAddress]: "done" }));
      setHits(prev => prev.map(h =>
        h.stealthAddress === hit.stealthAddress ? { ...h, balance: 0n } : h,
      ));
    } catch (e: unknown) {
      setShieldError(s => ({ ...s, [hit.stealthAddress]: (e as { message?: string })?.message ?? "Failed" }));
      setShieldStatus(s => ({ ...s, [hit.stealthAddress]: "error" }));
    }
  };

  return (
    <main className="page">
      {/* Header */}
      <div
        className="animate-fade-up page-col"
        style={{ marginBottom: 40 }}
      >
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
          Dashboard
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
          Scan on-chain announcements to detect stealth payments sent to you.
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
              // Scanning PQ hybrid announcements
            </span>
          )}
        </p>
      </div>

      <div
        className="animate-fade-up delay-1 page-col"
        style={{
          border: "1px solid var(--border)",
        }}
      >
        {!isConnected ? (
          <div style={{ padding: "var(--card-pad)" }}>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-secondary)",
                marginBottom: 16,
              }}
            >
              {">"} Connect your wallet to scan for stealth payments.
            </p>
            {connectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => connect({ connector: c })}
                disabled={isConnecting}
                style={{
                  width: "100%",
                  padding: "12px 20px",
                  marginBottom: 8,
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
        ) : (
          <div style={{ padding: "var(--card-pad)" }}>
            {!isRegistered ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginBottom: 12,
                  }}
                >
                  // not registered {pqEnabled ? "(PQ mode)" : "(classic mode)"}
                </p>
                <Link
                  href="/"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--green)",
                    textDecoration: "none",
                    border: "1px solid var(--green-dim)",
                    padding: "8px 16px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  Register first →
                </Link>
              </div>
            ) : (
              <>
                {/* Scan header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 20,
                  }}
                >
                  <div>
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
                      Scanning as
                    </p>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--green)",
                      }}
                    >
                      {truncateKey(address!, 8)}
                    </p>
                  </div>
                  <button
                    onClick={handleScan}
                    disabled={scanStatus === "scanning"}
                    style={{
                      padding: "10px 20px",
                      background:
                        scanStatus === "scanning"
                          ? "var(--surface)"
                          : "var(--green)",
                      color:
                        scanStatus === "scanning"
                          ? "var(--text-muted)"
                          : "#000",
                      border: "none",
                      cursor:
                        scanStatus === "scanning" ? "not-allowed" : "pointer",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                    }}
                  >
                    {scanStatus === "scanning"
                      ? "Scanning..."
                      : scanStatus === "done"
                        ? "↻ Rescan"
                        : "Scan →"}
                  </button>
                </div>

                {/* Progress */}
                {(scanStatus === "scanning" || scanStatus === "done") &&
                  progress && (
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color:
                          scanStatus === "done"
                            ? "var(--green)"
                            : "var(--text-muted)",
                        marginBottom: 16,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {scanStatus === "scanning" ? "// " : "✓ "}
                      {progress}
                    </p>
                  )}

                {/* Scan error */}
                {scanStatus === "error" && scanError && (
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "#1a0505",
                      border: "1px solid #3d0a0a",
                      marginBottom: 16,
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--red)",
                      }}
                    >
                      ✗ {scanError}
                    </p>
                  </div>
                )}

                {/* No results */}
                {scanStatus === "done" && hits.length === 0 && (
                  <div style={{ padding: "20px 0", textAlign: "center" }}>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      // no stealth payments found in the last{" "}
                      {ANNOUNCEMENT_SCAN_BLOCKS.toString()} blocks
                    </p>
                  </div>
                )}

                {/* Hits */}
                {hits.length > 0 && (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <div
                      style={{
                        padding: "10px 14px",
                        background: "var(--surface)",
                        border: "1px solid var(--green-muted)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                        }}
                      >
                        Total
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 14,
                          color: "var(--green)",
                          fontWeight: 700,
                        }}
                      >
                        {formatEther(
                          hits.reduce((acc, h) => acc + h.balance, 0n),
                        )}{" "}
                        ETH
                      </span>
                    </div>

                    {hits.map((hit) => {
                      const hasBalance = hit.balance > 0n;
                      const wStatus = withdrawStatus[hit.stealthAddress] ?? "idle";
                      const wDest = withdrawDest[hit.stealthAddress] ?? "";
                      const wHash = withdrawTxHash[hit.stealthAddress];
                      const wError = withdrawError[hit.stealthAddress];
                      const destOk = isAddress(wDest.trim());
                      const sStatus = shieldStatus[hit.stealthAddress] ?? "idle";
                      const sHash = shieldTxHash[hit.stealthAddress];
                      const sError = shieldError[hit.stealthAddress];

                      return (
                        <div
                          key={hit.stealthAddress}
                          style={{
                            padding: "14px 16px",
                            background: "var(--surface)",
                            border: `1px solid ${hasBalance ? "var(--green-dim)" : "var(--border)"}`,
                          }}
                        >
                          {/* Address + balance */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              marginBottom: 8,
                            }}
                          >
                            <div>
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
                                Stealth Address
                              </p>
                              <p
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                  color: "var(--green)",
                                  wordBreak: "break-all",
                                }}
                              >
                                {hit.stealthAddress}
                              </p>
                            </div>
                            <div
                              style={{
                                textAlign: "right",
                                flexShrink: 0,
                                marginLeft: 12,
                              }}
                            >
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
                                Balance
                              </p>
                              <p
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 13,
                                  color: hasBalance
                                    ? "var(--green)"
                                    : "var(--text-muted)",
                                  fontWeight: 700,
                                }}
                              >
                                {formatEther(hit.balance)} ETH
                              </p>
                            </div>
                          </div>

                          {/* Meta row */}
                          <div
                            style={{
                              display: "flex",
                              gap: 16,
                              marginBottom: 10,
                            }}
                          >
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
                                BLOCK
                              </p>
                              <p
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 10,
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {hit.blockNumber.toString()}
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
                                VIEW TAG
                              </p>
                              <p
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 10,
                                  color: "var(--text-secondary)",
                                }}
                              >
                                0x{hit.viewTag.toString(16).padStart(2, "0")}
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
                                TX
                              </p>
                              <a
                                href={`${chainConfig.explorer}/tx/${hit.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 10,
                                  color: "var(--green-dim)",
                                  textDecoration: "none",
                                }}
                              >
                                {truncateKey(hit.txHash, 6)} ↗
                              </a>
                            </div>
                          </div>


                          {/* Withdraw */}
                          {hasBalance && (
                            <div
                              style={{
                                padding: "10px 12px",
                                background: "#04080a",
                                border: "1px solid #0e2030",
                              }}
                            >
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
                                Withdraw funds
                              </p>
                              {wStatus === "idle" || wStatus === "error" ? (
                                <>
                                  <div style={{ display: "flex", gap: 8 }}>
                                    <input
                                      type="text"
                                      value={wDest}
                                      onChange={(e) =>
                                        setWithdrawDest((s) => ({
                                          ...s,
                                          [hit.stealthAddress]: e.target.value,
                                        }))
                                      }
                                      placeholder="Destination 0x..."
                                      spellCheck={false}
                                      style={{
                                        flex: 1,
                                        padding: "7px 10px",
                                        background: "#0a0e12",
                                        border: `1px solid ${destOk ? "var(--green-dim)" : "var(--border)"}`,
                                        color: "var(--text-primary)",
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 10,
                                        outline: "none",
                                      }}
                                    />
                                    <button
                                      onClick={() => handleWithdraw(hit)}
                                      disabled={!destOk}
                                      style={{
                                        padding: "7px 14px",
                                        flexShrink: 0,
                                        background: destOk
                                          ? "var(--green)"
                                          : "var(--surface)",
                                        color: destOk
                                          ? "#000"
                                          : "var(--text-muted)",
                                        border: destOk
                                          ? "none"
                                          : "1px solid var(--border)",
                                        cursor: destOk
                                          ? "pointer"
                                          : "not-allowed",
                                        fontFamily: "var(--font-mono)",
                                        fontWeight: 700,
                                        fontSize: 9,
                                        letterSpacing: "0.1em",
                                        textTransform: "uppercase",
                                      }}
                                    >
                                      Send
                                    </button>
                                  </div>
                                  {wError && (
                                    <p
                                      style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 9,
                                        color: "var(--red)",
                                        marginTop: 6,
                                        wordBreak: "break-all",
                                      }}
                                    >
                                      ✗ {wError}
                                    </p>
                                  )}
                                </>
                              ) : wStatus === "sending" ? (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 8,
                                      height: 8,
                                      border: "1.5px solid var(--border)",
                                      borderTop: "1.5px solid var(--green)",
                                      borderRadius: "50%",
                                      animation: "spin 1s linear infinite",
                                      flexShrink: 0,
                                    }}
                                  />
                                  <p
                                    style={{
                                      fontFamily: "var(--font-mono)",
                                      fontSize: 10,
                                      color: "var(--text-muted)",
                                    }}
                                  >
                                    // broadcasting...
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <p
                                    style={{
                                      fontFamily: "var(--font-mono)",
                                      fontSize: 10,
                                      color: "var(--green)",
                                      marginBottom: 4,
                                    }}
                                  >
                                    ✓ Sent
                                  </p>
                                  {wHash && (
                                    <a
                                      href={`${chainConfig.explorer}/tx/${wHash}`}
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
                                      {wHash}
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Shield to RAILGUN */}
                          {hasBalance && watcherReady && (
                            <div style={{ padding: "10px 12px", background: "#04080a", border: "1px solid #0e2030", marginTop: 6 }}>
                              <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                                Shield to RAILGUN
                              </p>
                              {sStatus === "idle" || sStatus === "error" ? (
                                <>
                                  <button
                                    onClick={() => handleShield(hit)}
                                    style={{ width: "100%", padding: "8px 0", background: "var(--green)", color: "#000", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}
                                  >
                                    Shield {formatEther(hit.balance)} ETH →
                                  </button>
                                  {sError && (
                                    <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--red)", marginTop: 6, wordBreak: "break-all" }}>✗ {sError}</p>
                                  )}
                                </>
                              ) : sStatus === "sending" ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ width: 8, height: 8, border: "1.5px solid var(--border)", borderTop: "1.5px solid var(--green)", borderRadius: "50%", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>// shielding...</p>
                                </div>
                              ) : (
                                <div>
                                  <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green)", marginBottom: 4 }}>✓ Shielded</p>
                                  {sHash && (
                                    <a href={`${chainConfig.explorer}/tx/${sHash}`} target="_blank" rel="noreferrer"
                                      style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-secondary)", wordBreak: "break-all", textDecoration: "none", borderBottom: "1px solid var(--border)" }}>
                                      {sHash}
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
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

      <div
        className="animate-fade-up delay-2"
        style={{
          marginTop: 32,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.1em",
          textAlign: "center",
        }}
      >
        ERC-5564 · {chainConfig.label.toUpperCase()}
        <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
        <Link
          href="/lookup"
          style={{ color: "var(--text-muted)", textDecoration: "none" }}
          onMouseOver={(e) =>
            (e.currentTarget.style.color = "var(--green-dim)")
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.color = "var(--text-muted)")
          }
        >
          lookup →
        </Link>
      </div>
    </main>
  );
}
