import { keccak256, toHex, toBytes, concat, hexToBytes, getAddress } from "viem";

export const SIGNING_MESSAGE =
  "Sign this message to access your stealth account.\n\nOnly sign on a trusted app.";

// ── ABI ───────────────────────────────────────────────────────────────────────
export { STEALTH_REGISTRY_ADDRESS } from "@/lib/constants";

export const STEALTH_REGISTRY_ABI = [
  {
    name: "registerKeys",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schemeId",           type: "uint256" },
      { name: "stealthMetaAddress", type: "bytes"   },
    ],
    outputs: [],
  },
  {
    name: "stealthMetaAddressOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "registrant", type: "address" },
      { name: "schemeId",   type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

// ── Key derivation ────────────────────────────────────────────────────────────

export interface StealthKeys {
  spendingPrivateKey:  `0x${string}`;
  spendingPublicKey:   `0x${string}`;
  viewingPrivateKey:   `0x${string}`;
  viewingPublicKey:    `0x${string}`;
  stealthMetaAddress:  `0x${string}`; // classic 67-byte meta-address
}

export async function deriveStealthKeys(
  signature: `0x${string}`,
): Promise<StealthKeys> {
  const { getPublicKey } = await import("@noble/secp256k1");

  const sigBytes = hexToBytes(signature);

  const spendingPrivKeyBytes = hexToBytes(keccak256(toHex(sigBytes.slice(0, 32))));
  const viewingPrivKeyBytes  = hexToBytes(keccak256(toHex(sigBytes.slice(32, 64))));

  const spendingPubKeyBytes = getPublicKey(spendingPrivKeyBytes, true);
  const viewingPubKeyBytes  = getPublicKey(viewingPrivKeyBytes,  true);

  const spendingPrivateKey = toHex(spendingPrivKeyBytes) as `0x${string}`;
  const spendingPublicKey  = toHex(spendingPubKeyBytes)  as `0x${string}`;
  const viewingPrivateKey  = toHex(viewingPrivKeyBytes)  as `0x${string}`;
  const viewingPublicKey   = toHex(viewingPubKeyBytes)   as `0x${string}`;

  // classic meta-address: 0x00 + pk_spend + pk_view = 67 bytes
  const stealthMetaAddress = toHex(
    concat([new Uint8Array([0x00]), spendingPubKeyBytes, viewingPubKeyBytes]),
  ) as `0x${string}`;

  return {
    spendingPrivateKey,
    spendingPublicKey,
    viewingPrivateKey,
    viewingPublicKey,
    stealthMetaAddress,
  };
}

// ── MetaAddress parsing ───────────────────────────────────────────────────────

export interface ParsedMetaAddress {
  spendingPublicKey: Uint8Array; // 33 bytes
  viewingPublicKey:  Uint8Array; // 33 bytes
}

export function parseMetaAddress(raw: `0x${string}`): ParsedMetaAddress {
  const bytes = hexToBytes(raw);
  // classic: 0x00 + pk_spend(33) + pk_view(33) = 67 bytes
  if (bytes.length === 67 && bytes[0] === 0x00) {
    return {
      spendingPublicKey: bytes.slice(1, 34),
      viewingPublicKey:  bytes.slice(34, 67),
    };
  }
  // ERC-5564 standard (no prefix): 66 bytes
  if (bytes.length === 66) {
    return {
      spendingPublicKey: bytes.slice(0, 33),
      viewingPublicKey:  bytes.slice(33, 66),
    };
  }
  throw new Error(`Unrecognized classic metaAddress (${bytes.length} bytes)`);
}

// ── Stealth address generation ────────────────────────────────────────────────

export interface StealthAddressResult {
  stealthAddress: `0x${string}`;
  ephemeralPubkey: `0x${string}`; // R = r·G (33 bytes)
  viewTag: number;
}

export async function generateStealthAddress(
  spendingPublicKey: `0x${string}`,
  viewingPublicKey:  `0x${string}`,
): Promise<StealthAddressResult> {
  const { getPublicKey, getSharedSecret, Point, utils } = await import("@noble/secp256k1");

  const pkSpendBytes = hexToBytes(spendingPublicKey);
  const pkViewBytes  = hexToBytes(viewingPublicKey);

  const r = utils.randomSecretKey();
  const R = getPublicKey(r, true); // 33 bytes

  const sharedCompressed = getSharedSecret(r, pkViewBytes, true);
  const sharedX = sharedCompressed.slice(1); // x-coordinate, 32 bytes

  const h       = keccak256(toHex(sharedX));
  const viewTag = parseInt(h.slice(2, 4), 16);

  const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const hScalar = BigInt(h) % SECP256K1_N;

  const stealthPoint = Point.fromBytes(pkSpendBytes).add(Point.BASE.multiply(hScalar));
  const uncompressed  = stealthPoint.toBytes(false);
  const addrHash      = keccak256(toHex(uncompressed.slice(1)));
  const stealthAddress = getAddress(`0x${addrHash.slice(-40)}`) as `0x${string}`;

  return {
    stealthAddress,
    ephemeralPubkey: toHex(R) as `0x${string}`,
    viewTag,
  };
}

// ── Announcement check ────────────────────────────────────────────────────────

export interface AnnouncementCheckResult {
  stealthAddress: `0x${string}`;
  spendingKey:    `0x${string}`;
  viewTag:        number;
}

export async function checkAnnouncement(
  skView:           `0x${string}`,
  skSpend:          `0x${string}`,
  ephemeralPubkey:  `0x${string}`,
  announcedAddress: `0x${string}`,
  announcedViewTag: number,
): Promise<AnnouncementCheckResult | null> {
  const { getPublicKey, getSharedSecret, Point } = await import("@noble/secp256k1");

  const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

  const skViewBytes  = hexToBytes(skView);
  const skSpendBytes = hexToBytes(skSpend);
  const pkSpendBytes = getPublicKey(skSpendBytes, true);
  const R            = hexToBytes(ephemeralPubkey);

  const sharedCompressed = getSharedSecret(skViewBytes, R, true);
  const sharedX          = sharedCompressed.slice(1);

  const h       = keccak256(toHex(sharedX));
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

// ── Helpers ───────────────────────────────────────────────────────────────────

export function truncateKey(key: string, chars = 8): string {
  return `${key.slice(0, chars + 2)}...${key.slice(-chars)}`;
}
