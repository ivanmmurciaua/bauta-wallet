import { keccak256, toHex, toBytes, concat, hexToBytes, getAddress } from "viem";

// ── PQ key interface (extends classic with ML-KEM keys) ───────────────────────

export interface PQStealthKeys {
  spendingPrivateKey:  `0x${string}`;
  spendingPublicKey:   `0x${string}`;
  viewingPrivateKey:   `0x${string}`;
  viewingPublicKey:    `0x${string}`;
  mlkemEncapsKey:      Uint8Array;  // 1184 bytes — public (shared to recipients)
  mlkemDecapsKey:      Uint8Array;  // 2400 bytes — private (kept secret)
  pqMetaAddress:       `0x${string}`; // 1251-byte: 0x00 + pk_spend(33) + pk_view(33) + ek(1184)
}

// ── Parsed PQ meta-address ─────────────────────────────────────────────────────

export interface ParsedPQMetaAddress {
  spendingPublicKey:  Uint8Array; // 33 bytes
  viewingPublicKey:   Uint8Array; // 33 bytes
  mlkemEncapsKey:     Uint8Array; // 1184 bytes
}

// ── Key derivation ────────────────────────────────────────────────────────────

export async function derivePQKeys(
  signature: `0x${string}`,
): Promise<PQStealthKeys> {
  const { getPublicKey } = await import("@noble/secp256k1");
  const { ml_kem768 }    = await import("@noble/post-quantum/ml-kem.js");

  const sigBytes = hexToBytes(signature);

  // Classic EC keys (same derivation as stealth.ts)
  const spendingPrivKeyBytes = hexToBytes(keccak256(toHex(sigBytes.slice(0, 32))));
  const viewingPrivKeyBytes  = hexToBytes(keccak256(toHex(sigBytes.slice(32, 64))));
  const spendingPubKeyBytes  = getPublicKey(spendingPrivKeyBytes, true);
  const viewingPubKeyBytes   = getPublicKey(viewingPrivKeyBytes,  true);

  // ML-KEM-768 keypair — deterministic 64-byte seed from signature
  const kemSeedPart1 = hexToBytes(keccak256(toHex(concat([sigBytes, new Uint8Array([0x4b, 0x45, 0x4d, 0x01])]))));
  const kemSeedPart2 = hexToBytes(keccak256(toHex(concat([sigBytes, new Uint8Array([0x4b, 0x45, 0x4d, 0x02])]))));
  const kemSeed = concat([kemSeedPart1, kemSeedPart2]); // 64 bytes

  const { publicKey: mlkemEncapsKey, secretKey: mlkemDecapsKey } = ml_kem768.keygen(kemSeed);

  // PQ meta-address: 0x00 + pk_spend(33) + pk_view(33) + ek(1184) = 1251 bytes
  const pqMetaAddress = toHex(
    concat([new Uint8Array([0x00]), spendingPubKeyBytes, viewingPubKeyBytes, mlkemEncapsKey]),
  ) as `0x${string}`;

  return {
    spendingPrivateKey:  toHex(spendingPrivKeyBytes) as `0x${string}`,
    spendingPublicKey:   toHex(spendingPubKeyBytes)  as `0x${string}`,
    viewingPrivateKey:   toHex(viewingPrivKeyBytes)  as `0x${string}`,
    viewingPublicKey:    toHex(viewingPubKeyBytes)   as `0x${string}`,
    mlkemEncapsKey,
    mlkemDecapsKey,
    pqMetaAddress,
  };
}

// ── Meta-address parsing ───────────────────────────────────────────────────────

export function parsePQMetaAddress(raw: `0x${string}`): ParsedPQMetaAddress {
  const bytes = hexToBytes(raw);
  // 0x00 + pk_spend(33) + pk_view(33) + ek(1184) = 1251 bytes
  if (bytes.length === 1251 && bytes[0] === 0x00) {
    return {
      spendingPublicKey: bytes.slice(1,    34),
      viewingPublicKey:  bytes.slice(34,   67),
      mlkemEncapsKey:    bytes.slice(67, 1251),
    };
  }
  throw new Error(`Unrecognized PQ metaAddress (${bytes.length} bytes, expected 1251)`);
}

// ── PQ stealth address result ─────────────────────────────────────────────────

export interface PQStealthAddressResult {
  stealthAddress:  `0x${string}`;
  ephemeralPubkey: `0x${string}`; // R = r·G (33 bytes)
  kemCiphertext:   `0x${string}`; // 1088 bytes
  viewTag:         number;
}

// ── Generate PQ stealth address (sender side) ─────────────────────────────────

export async function generatePQStealthAddress(
  spendingPublicKey: `0x${string}`,
  viewingPublicKey:  `0x${string}`,
  mlkemEncapsKey:    Uint8Array,
): Promise<PQStealthAddressResult> {
  const { getPublicKey, getSharedSecret, Point, utils } = await import("@noble/secp256k1");
  const { ml_kem768 } = await import("@noble/post-quantum/ml-kem.js");

  const pkSpendBytes = hexToBytes(spendingPublicKey);
  const pkViewBytes  = hexToBytes(viewingPublicKey);

  // EC ephemeral key
  const r = utils.randomSecretKey();
  const R = getPublicKey(r, true); // 33 bytes

  // ECDH shared secret (x-coordinate)
  const sharedCompressed = getSharedSecret(r, pkViewBytes, true);
  const sharedX = sharedCompressed.slice(1); // 32 bytes

  // ML-KEM encapsulation → ciphertext + shared secret
  const { cipherText: kemCiphertextBytes, sharedSecret: sharedKem } = ml_kem768.encapsulate(mlkemEncapsKey);

  // Hybrid hash: h = keccak256(ecdh_secret || kem_secret)
  const h       = keccak256(toHex(concat([sharedX, sharedKem])));
  const viewTag = parseInt(h.slice(2, 4), 16);

  const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const hScalar = BigInt(h) % SECP256K1_N;

  const stealthPoint   = Point.fromBytes(pkSpendBytes).add(Point.BASE.multiply(hScalar));
  const uncompressed   = stealthPoint.toBytes(false);
  const addrHash       = keccak256(toHex(uncompressed.slice(1)));
  const stealthAddress = getAddress(`0x${addrHash.slice(-40)}`) as `0x${string}`;

  return {
    stealthAddress,
    ephemeralPubkey: toHex(R) as `0x${string}`,
    kemCiphertext:   toHex(kemCiphertextBytes) as `0x${string}`,
    viewTag,
  };
}

// ── Check PQ announcement (recipient side) ────────────────────────────────────

export interface PQAnnouncementCheckResult {
  stealthAddress: `0x${string}`;
  spendingKey:    `0x${string}`;
  viewTag:        number;
}

export async function checkPQAnnouncement(
  skView:           `0x${string}`,
  skSpend:          `0x${string}`,
  mlkemDecapsKey:   Uint8Array,
  ephemeralPubkey:  `0x${string}`,
  kemCiphertext:    `0x${string}`,
  announcedAddress: `0x${string}`,
  announcedViewTag: number,
): Promise<PQAnnouncementCheckResult | null> {
  const { getPublicKey, getSharedSecret, Point } = await import("@noble/secp256k1");
  const { ml_kem768 } = await import("@noble/post-quantum/ml-kem.js");

  const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

  const skViewBytes  = hexToBytes(skView);
  const skSpendBytes = hexToBytes(skSpend);
  const pkSpendBytes = getPublicKey(skSpendBytes, true);
  const R            = hexToBytes(ephemeralPubkey);
  const ct           = hexToBytes(kemCiphertext);

  // ECDH
  const sharedCompressed = getSharedSecret(skViewBytes, R, true);
  const sharedX          = sharedCompressed.slice(1);

  // ML-KEM decapsulation (secretKey = decapsulation key)
  const sharedKem = ml_kem768.decapsulate(ct, mlkemDecapsKey);

  // Hybrid hash
  const h       = keccak256(toHex(concat([sharedX, sharedKem])));
  const viewTag = parseInt(h.slice(2, 4), 16);

  if (viewTag !== announcedViewTag) return null;

  const hScalar = BigInt(h) % SECP256K1_N;

  const stealthPoint   = Point.fromBytes(pkSpendBytes).add(Point.BASE.multiply(hScalar));
  const uncompressed   = stealthPoint.toBytes(false);
  const addrHash       = keccak256(toHex(uncompressed.slice(1)));
  const stealthAddress = getAddress(`0x${addrHash.slice(-40)}`) as `0x${string}`;

  if (stealthAddress.toLowerCase() !== announcedAddress.toLowerCase()) return null;

  const skStealthScalar = (BigInt(toHex(skSpendBytes)) + hScalar) % SECP256K1_N;
  const spendingKey = `0x${skStealthScalar.toString(16).padStart(64, "0")}` as `0x${string}`;

  return { stealthAddress, spendingKey, viewTag };
}
