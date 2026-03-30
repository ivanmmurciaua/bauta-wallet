/**
 * setup.ts
 * One-time setup wizard.
 *
 * Usage: npm run setup
 *
 * Steps:
 *   1. Warn about network disconnection (optional)
 *   2. Enter mnemonic (hidden, no echo)
 *   3. Enter passphrase x2
 *   4. Init RAILGUN engine + create wallet → railgunAddress + walletId
 *   5. Derive railgunEncryptionKey from seed
 *   6. Encrypt vault.enc  { railgunAddress, railgunWalletId, railgunEncryptionKey }
 *   7. Write railgunAddress to config.yaml
 *   8. Done — seed never written to disk
 */

import * as readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Mnemonic } from "ethers";

import { createHash } from "crypto";
import { prompt, promptHidden } from "./prompt.js";
import { deriveKeysFromMnemonic } from "./derive.js";
import { avoidRailgunScanningErrors, avoidRailgunErrors } from "./config.js";
import { encryptVault, vaultExists, defaultVaultPath } from "./vault.js";
import { initRailgunEngine, createWallet } from "./railgun.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "..", "config.yaml");
const VAULT_PATH = defaultVaultPath();
const PASSPHRASE_PATH = path.resolve(__dirname, "..", "passphrase.txt");

const CONNECTIVITY_CHECK_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const CONNECTIVITY_RETRY_MS = 5000;

async function waitForConnectivity(): Promise<void> {
  while (true) {
    try {
      await fetch(CONNECTIVITY_CHECK_URL, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      return;
    } catch {
      process.stdout.write(
        `      No network — retrying in ${CONNECTIVITY_RETRY_MS / 1000}s...\r`,
      );
      await new Promise((r) => setTimeout(r, CONNECTIVITY_RETRY_MS));
    }
  }
}

function updateConfigYaml(railgunAddress: string): void {
  let content = fs.readFileSync(CONFIG_PATH, "utf8");
  content = content.replace(
    /^railgunAddress:.*$/m,
    `railgunAddress: "${railgunAddress}"`,
  );
  fs.writeFileSync(CONFIG_PATH, content);
}

async function main() {
  avoidRailgunScanningErrors();
  avoidRailgunErrors();
  process.stdout.write("\x1Bc");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║        stealth-watcher · setup           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (vaultExists(VAULT_PATH)) {
    const answer = await prompt(
      rl,
      "⚠  vault.enc already exists. Overwrite? (yes/no): ",
    );
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Aborted.");
      rl.close();
      process.exit(0);
    }
  }

  console.log("─────────────────────────────────────────────");
  console.log("  SECURITY RECOMMENDATION");
  console.log("  Consider disconnecting from the network");
  console.log("  before entering your seed phrase.");
  console.log("─────────────────────────────────────────────\n");

  const proceed = await prompt(rl, "Continue? (yes/no): ");
  if (proceed.trim().toLowerCase() !== "yes") {
    console.log("Aborted.");
    rl.close();
    process.exit(0);
  }

  const wordCountStr = await prompt(
    rl,
    "How many words is your seed phrase? (12/18/24): ",
  );
  rl.close();

  const wordCount = parseInt(wordCountStr.trim(), 10);
  if (![12, 18, 24].includes(wordCount)) {
    console.error("\n✗ Invalid word count. Must be 12, 18 or 24.");
    process.exit(1);
  }

  process.stdout.write("\x1Bc");
  const mnemonic = await promptHidden("Enter seed phrase:", wordCount);

  if (!Mnemonic.isValidMnemonic(mnemonic)) {
    console.error("\n✗ Invalid mnemonic. Aborting.");
    process.exit(1);
  }

  const passphrase = await promptHidden("Enter passphrase:");
  const passphrase2 = await promptHidden("Confirm passphrase:");

  if (passphrase !== passphrase2) {
    console.error("\n✗ Passphrases do not match. Aborting.");
    process.exit(1);
  }
  if (passphrase.length < 8) {
    console.error("\n✗ Passphrase too short (minimum 8 characters).");
    process.exit(1);
  }

  // Derive railgunEncryptionKey from seed (deterministic, never stored separately)
  console.log("\n[1/3] Preparing...");
  const { railgunEncryptionKey } = deriveKeysFromMnemonic(mnemonic);

  // Wait for network connectivity before hitting RAILGUN
  console.log("[2/3] Checking network connectivity...");
  await waitForConnectivity();
  console.log("      Network OK.");

  // Init RAILGUN engine + create wallet
  console.log("[3/4] Initializing RAILGUN engine...");
  console.log("      (First run downloads ~50MB of ZK artifacts)");
  try {
    await initRailgunEngine();
    console.log("      Engine started.");
  } catch (e: any) {
    console.error("      ✗ Engine init failed:", e.message);
    process.exit(1);
  }

  console.log("      Creating RAILGUN wallet...");
  let walletId: string;
  let railgunAddress: string;
  try {
    ({ walletId, railgunAddress } = await createWallet(
      mnemonic,
      railgunEncryptionKey,
    ));
    console.log(`      RAILGUN address: ${railgunAddress}`);
  } catch (e: any) {
    console.error("      ✗ Wallet creation failed:", e.message);
    process.exit(1);
  }

  // Hash passphrase — sha256(passphrase) is used as the actual vault key
  const passphraseHash = createHash("sha256").update(passphrase).digest("hex");

  // Encrypt vault — stealth keys come from frontend, not stored here
  console.log("\n[4/4] Encrypting vault...");
  console.log(`      Path: ${VAULT_PATH}`);
  encryptVault(
    {
      railgunAddress: railgunAddress!,
      railgunWalletId: walletId!,
      railgunEncryptionKey,
    },
    passphraseHash,
    VAULT_PATH,
  );
  console.log(`      vault.enc written.`);

  fs.writeFileSync(PASSPHRASE_PATH, passphraseHash, "utf8");
  console.log(`      passphrase.txt written.`);

  updateConfigYaml(railgunAddress);
  console.log(`      config.yaml updated.`);

  console.log(
    "\n✓ Setup complete. Your seed phrase was never written to disk.",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Setup failed:", err.message);
  process.exit(1);
});
