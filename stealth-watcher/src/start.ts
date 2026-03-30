/**
 * start.ts
 * Entrypoint for the stealth-watcher service.
 *
 * Usage: npm run start
 *
 * 1. Prompt passphrase → decrypt vault.enc
 * 2. Init RAILGUN engine + load wallet
 * 3. Start HTTP server (health, ready, register, shield)
 * 4. Start watcher loop (coming in watcher.ts)
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { promptHidden } from "./prompt.js";
import { decryptVault, defaultVaultPath } from "./vault.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASSPHRASE_PATH = path.resolve(__dirname, "..", "passphrase.txt");
import {
  initRailgunEngine,
  loadWallet,
  setupBalanceCallback,
} from "./railgun.js";
import { initializeBroadcasters } from "./broadcaster.js";
import { router } from "./server.js";
import { avoidRailgunScanningErrors, avoidRailgunErrors } from "./config.js";
// import { loadStore, getAllRegistrations, resetAllCheckpoints } from "./store.js";
// import { startScanner, enqueueScan } from "./scanner.js";

const PORT = process.env.WATCHER_PORT
  ? parseInt(process.env.WATCHER_PORT)
  : 8765;
const FE_PORT = process.env.FE_PORT ? parseInt(process.env.FE_PORT) : 8766;
const VAULT_PATH = defaultVaultPath();

// Global state — set after successful init
export let isReady = false;
export let vaultData: Awaited<ReturnType<typeof decryptVault>> | null = null;

async function main() {
  avoidRailgunScanningErrors();
  avoidRailgunErrors();
  process.stdout.write("\x1Bc");
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║       stealth-watcher · starting         ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // Step 1 — decrypt vault
  // If passphrase.txt exists (Docker / non-interactive), read hash directly.
  // Otherwise prompt interactively and hash on the fly.
  let passphraseHash: string;
  if (fs.existsSync(PASSPHRASE_PATH)) {
    passphraseHash = fs.readFileSync(PASSPHRASE_PATH, "utf8").trim();
  } else {
    const raw = await promptHidden("Enter passphrase:", 0);
    passphraseHash = createHash("sha256").update(raw).digest("hex");
  }

  try {
    vaultData = decryptVault(passphraseHash, VAULT_PATH);
  } catch (err: any) {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
  }
  console.log("[1/3] Vault decrypted.");

  // Step 2 — init RAILGUN engine
  console.log("[2/3] Initializing RAILGUN engine...");
  console.log(
    "      (ZK artifacts load from disk — no download if already cached)",
  );
  await initRailgunEngine();
  await loadWallet(vaultData.railgunEncryptionKey, vaultData.railgunWalletId);
  setupBalanceCallback();
  console.log(`      RAILGUN wallet ready: ${vaultData.railgunAddress}`);

  // Step 3 — HTTP server starts now so /health is reachable during Waku init
  //          isReady stays false → /ready returns 503 until Waku is up
  const server = http.createServer(router);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(
    `[3/3] HTTP server on :${PORT} — waiting for Waku broadcasters...`,
  );

  // Step 3 (continued) — await Waku; fatal if it fails
  await initializeBroadcasters();
  console.log("      Waku broadcaster connected");

  isReady = true;
  console.log(`\n✓ stealth-watcher ready on ${PORT}\n`);
  console.log(`✓ You can access now to http://localhost:${FE_PORT}\n`);

  // Scanner on hold (code kept, not started)
  // loadStore();
  // resetAllCheckpoints();
  // for (const reg of getAllRegistrations()) enqueueScan(reg);
  // startScanner();
}

main().catch((err) => {
  console.error("\n✗ Fatal error:", err.message);
  process.exit(1);
});
