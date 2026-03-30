/**
 * vault.ts
 * Encrypts/decrypts sensitive key material using AES-256-GCM.
 * The seed phrase is NEVER stored. Only derived keys are persisted.
 *
 * Format of vault.enc:
 *   [4 bytes: version=1] [32 bytes: PBKDF2 salt] [12 bytes: AES-GCM IV] [N bytes: ciphertext+authTag]
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEYLEN = 32; // AES-256
const PBKDF2_DIGEST = "sha512";
const SALT_LEN = 32;
const IV_LEN = 12;
const VERSION_LEN = 4;

export interface VaultData {
  railgunAddress: string;        // 0zk... public RAILGUN address
  railgunWalletId: string;       // RAILGUN internal wallet ID (LevelDB key)
  railgunEncryptionKey: string;  // hex, encrypts the wallet in LevelDB
  // Stealth keys (viewKey, spendKey) are NOT stored here.
  // They are sent by the frontend at registration time and kept in memory only.
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
}

export function encryptVault(data: VaultData, passphrase: string, vaultPath: string): void {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);

  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  const version = Buffer.alloc(VERSION_LEN);
  version.writeUInt32BE(VAULT_VERSION, 0);

  const output = Buffer.concat([version, salt, iv, authTag, encrypted]);
  fs.writeFileSync(vaultPath, output);
}

export function decryptVault(passphrase: string, vaultPath: string): VaultData {
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault not found at ${vaultPath}. Run 'npm run setup' first.`);
  }

  const raw = fs.readFileSync(vaultPath);

  const version = raw.readUInt32BE(0);
  if (version !== VAULT_VERSION) {
    throw new Error(`Unknown vault version: ${version}`);
  }

  let offset = VERSION_LEN;
  const salt = raw.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = raw.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const authTag = raw.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = raw.subarray(offset);

  const key = deriveKey(passphrase, salt);

  let plaintext: Buffer;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Decryption failed. Wrong passphrase or corrupted vault.");
  }

  return JSON.parse(plaintext.toString("utf8")) as VaultData;
}

export function vaultExists(vaultPath: string): boolean {
  return fs.existsSync(vaultPath);
}

export function defaultVaultPath(): string {
  return path.resolve(__dirname, "..", "vault.enc");
}
