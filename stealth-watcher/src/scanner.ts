/**
 * scanner.ts
 * Polls ERC-5564 Announcement events and checks them against registered accounts.
 * Detect-only — no shield triggered here.
 */
import { http, createPublicClient, fallback } from "viem";
import { sepolia } from "viem/chains";
import { checkAnnouncement, checkPQAnnouncementDetect } from "./detector.js";
import { getAllRegistrations, setUserScannedBlock, addHit, type Registration } from "./store.js";
import { PROVIDER } from "./config.js";

const STEALTH_ANNOUNCER_ADDRESS = "0x55649E01B5Df198D18D95b5cc5051630cfD45564" as `0x${string}`;

const STEALTH_ANNOUNCER_EVENT = {
  type: "event",
  name: "Announcement",
  inputs: [
    { name: "schemeId",        type: "uint256", indexed: true  },
    { name: "stealthAddress",  type: "address", indexed: true  },
    { name: "caller",          type: "address", indexed: true  },
    { name: "ephemeralPubKey", type: "bytes",   indexed: false },
    { name: "metadata",        type: "bytes",   indexed: false },
  ],
} as const;

const INITIAL_SCAN_BLOCKS = 20_000n;
const SCAN_CHUNK_SIZE     = 1_000n;
const SCAN_INTERVAL_MS    = 30_000;
const MIN_HIT_BALANCE     = 100_000_000_000_000n; // 0.0001 ETH
const CHUNK_DELAY_MS      = 150; // pause between getLogs chunks to avoid rate limits

const publicClient = createPublicClient({
  chain: sepolia,
  transport: fallback([
    http((PROVIDER as any)._getConnection?.().url ?? "https://rpc.sepolia.org", { timeout: 5_000 }),
    http("https://rpc.sepolia.org",                     { timeout: 5_000 }),
    http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 5_000 }),
    http("https://sepolia.gateway.tenderly.co",         { timeout: 5_000 }),
  ], { rank: true }),
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Initial-scan queue ────────────────────────────────────────────────────────
// Serialises scanUserNow calls so N concurrent registrations don't fire N
// parallel bursts of getLogs requests against the RPC.

const initialScanQueue: Registration[] = [];
let initialScanRunning = false;

async function drainInitialScanQueue(): Promise<void> {
  if (initialScanRunning) return;
  initialScanRunning = true;
  while (initialScanQueue.length > 0) {
    const reg = initialScanQueue.shift()!;
    await runInitialScan(reg);
  }
  initialScanRunning = false;
}

export function enqueueScan(reg: Registration): void {
  initialScanQueue.push(reg);
  drainInitialScanQueue(); // fire-and-forget — errors logged inside
}

// ── Core helpers ──────────────────────────────────────────────────────────────

async function checkLogForUser(
  reg: Registration,
  ephemeralPubKey: string,
  stealthAddress: string,
  metadata: string,
  blockNumber: bigint,
  txHash: string,
  schemeId: bigint,
): Promise<void> {
  // Skip logs whose schemeId doesn't match this user's registered scheme
  if (schemeId.toString() !== reg.schemeId) return;

  const announcedViewTag = parseInt(metadata.slice(2, 4), 16);
  try {
    let hit;
    if (reg.schemeId === "4" && reg.mlkemDecapsKey) {
      // PQ hybrid: metadata = viewTag(1b) + kemCiphertext(1088b)
      // hex string: "0x" + 2 viewTag chars + 2176 kemCiphertext chars = min 2180 chars
      if (metadata.length < 2180) return;
      const kemCiphertext = `0x${metadata.slice(4)}` as `0x${string}`;
      const { hexToBytes } = await import("viem");
      const mlkemDecapsKey = hexToBytes(reg.mlkemDecapsKey as `0x${string}`);
      hit = await checkPQAnnouncementDetect(
        reg.skView  as `0x${string}`,
        reg.pkSpend as `0x${string}`,
        mlkemDecapsKey,
        ephemeralPubKey as `0x${string}`,
        kemCiphertext,
        stealthAddress  as `0x${string}`,
        announcedViewTag,
      );
    } else {
      hit = await checkAnnouncement(
        reg.skView  as `0x${string}`,
        reg.pkSpend as `0x${string}`,
        ephemeralPubKey as `0x${string}`,
        stealthAddress  as `0x${string}`,
        announcedViewTag,
      );
    }
    if (!hit) return;

    let balance = 0n;
    try { balance = await publicClient.getBalance({ address: hit.stealthAddress }); } catch { /* ignore */ }

    if (balance >= MIN_HIT_BALANCE) {
      console.log(`[scanner] HIT ${reg.eoaAddress.slice(0, 10)} → ${hit.stealthAddress} balance=${balance} block=${blockNumber}`);
      addHit(reg.eoaAddress, reg.schemeId, {
        stealthAddress: hit.stealthAddress,
        blockNumber:    blockNumber.toString(),
        txHash,
        schemeId:       schemeId.toString(),
        detectedAt:     new Date().toISOString(),
        balance:        balance.toString(),
      });
    }
  } catch (err) {
    // Silently skip malformed announcements (bad ephemeral point, etc.)
    if (err instanceof Error && (err.message.includes("not on curve") || err.message.includes("bad point"))) return;
    console.error(`[scanner] check error for ${reg.eoaAddress.slice(0, 10)}:`, err);
  }
}

async function getLogs(fromBlock: bigint, toBlock: bigint) {
  return publicClient.getLogs({
    address:   STEALTH_ANNOUNCER_ADDRESS,
    event:     STEALTH_ANNOUNCER_EVENT,
    fromBlock,
    toBlock,
  });
}

// ── Initial scan (one user, run from queue) ───────────────────────────────────

async function runInitialScan(reg: Registration): Promise<void> {
  let latestBlock: bigint;
  try {
    latestBlock = await publicClient.getBlockNumber() - 2n;
  } catch (err) {
    console.error("[scanner] eth_blockNumber failed (initial scan):", err);
    return;
  }

  const fromBlock = reg.scannedUpToBlock != null
    ? BigInt(reg.scannedUpToBlock) + 1n
    : latestBlock - INITIAL_SCAN_BLOCKS;

  if (fromBlock > latestBlock) return;

  console.log(`[scanner] initial scan ${reg.eoaAddress.slice(0, 10)} blocks ${fromBlock}–${latestBlock}`);

  for (let cursor = fromBlock; cursor <= latestBlock; cursor += SCAN_CHUNK_SIZE) {
    const chunkEnd = cursor + SCAN_CHUNK_SIZE - 1n < latestBlock
      ? cursor + SCAN_CHUNK_SIZE - 1n
      : latestBlock;

    let logs;
    try {
      logs = await getLogs(cursor, chunkEnd);
    } catch (err) {
      console.error(`[scanner] getLogs failed ${cursor}–${chunkEnd}:`, err);
      return;
    }

    for (const log of logs) {
      const { schemeId, stealthAddress, ephemeralPubKey, metadata } = log.args;
      if (!schemeId || !stealthAddress || !ephemeralPubKey || !metadata) continue;
      await checkLogForUser(reg, ephemeralPubKey as string, stealthAddress as string, metadata as string, log.blockNumber ?? chunkEnd, log.transactionHash ?? "0x", schemeId);
    }

    if (cursor + SCAN_CHUNK_SIZE <= latestBlock) await sleep(CHUNK_DELAY_MS);
  }

  setUserScannedBlock(reg.eoaAddress, reg.schemeId, latestBlock);
  console.log(`[scanner] initial scan done → checkpoint ${latestBlock}`);
}

// ── Periodic tick (all ready users, shared getLogs) ───────────────────────────

async function runScanTick(): Promise<void> {
  const registrations = getAllRegistrations();

  // Only include users whose initial scan has already completed
  const ready = registrations.filter(r => r.scannedUpToBlock !== null);
  if (ready.length === 0) return;

  let latestBlock: bigint;
  try {
    latestBlock = await publicClient.getBlockNumber() - 2n;
  } catch (err) {
    console.error("[scanner] eth_blockNumber failed:", err);
    return;
  }

  const fromBlocks = ready.map(r => BigInt(r.scannedUpToBlock!) + 1n);
  const globalFrom = fromBlocks.reduce((min, b) => b < min ? b : min, fromBlocks[0]);

  if (globalFrom > latestBlock) return;

  console.log(`[scanner] tick: blocks ${globalFrom}–${latestBlock} · ${ready.length} user(s)`);

  for (let cursor = globalFrom; cursor <= latestBlock; cursor += SCAN_CHUNK_SIZE) {
    const chunkEnd = cursor + SCAN_CHUNK_SIZE - 1n < latestBlock
      ? cursor + SCAN_CHUNK_SIZE - 1n
      : latestBlock;

    let logs;
    try {
      logs = await getLogs(cursor, chunkEnd);
    } catch (err) {
      console.error(`[scanner] getLogs failed ${cursor}–${chunkEnd}:`, err);
      return;
    }

    if (logs.length > 0) {
      console.log(`[scanner] ${logs.length} announcement(s) in ${cursor}–${chunkEnd}`);
      for (const log of logs) {
        const { schemeId, stealthAddress, ephemeralPubKey, metadata } = log.args;
        if (!schemeId || !stealthAddress || !ephemeralPubKey || !metadata) continue;
        const logBlock = log.blockNumber ?? chunkEnd;
        // Only check users who hadn't yet scanned past this block
        const relevantUsers = ready.filter((_, i) => fromBlocks[i] <= logBlock);
        await Promise.all(relevantUsers.map(reg =>
          checkLogForUser(reg, ephemeralPubKey as string, stealthAddress as string, metadata as string, logBlock, log.transactionHash ?? "0x", schemeId),
        ));
      }
    }

    if (cursor + SCAN_CHUNK_SIZE <= latestBlock) await sleep(CHUNK_DELAY_MS);
  }

  for (const reg of ready) {
    setUserScannedBlock(reg.eoaAddress, reg.schemeId, latestBlock);
  }
  console.log(`[scanner] checkpoints → ${latestBlock}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startScanner(): void {
  console.log(`[scanner] started — polling every ${SCAN_INTERVAL_MS / 1000}s`);
  runScanTick();
  setInterval(runScanTick, SCAN_INTERVAL_MS);
}
