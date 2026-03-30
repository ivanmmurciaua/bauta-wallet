/**
 * detector.ts
 * Checks whether an ERC-5564 Announcement belongs to a registered user.
 * Uses viewKey (private) + pkSpend (public) — no spend key needed to detect.
 */
import { keccak256, toHex, hexToBytes, getAddress } from "viem";

const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export interface ScanHit {
  stealthAddress: `0x${string}`;
  viewTag: number;
}

export async function checkAnnouncement(
  skView:           `0x${string}`,
  pkSpend:          `0x${string}`,
  ephemeralPubkey:  `0x${string}`,
  announcedAddress: `0x${string}`,
  announcedViewTag: number,
): Promise<ScanHit | null> {
  const { getSharedSecret, Point } = await import("@noble/secp256k1");

  const skViewBytes  = hexToBytes(skView);
  const pkSpendBytes = hexToBytes(pkSpend);
  const R            = hexToBytes(ephemeralPubkey);

  // S = sk_view * R  (ECDH)
  const sharedCompressed = getSharedSecret(skViewBytes, R, true);
  const sharedX          = sharedCompressed.slice(1); // 32-byte x-coordinate

  const h       = keccak256(toHex(sharedX));
  const viewTag = parseInt(h.slice(2, 4), 16);

  if (viewTag !== announcedViewTag) return null;

  const hScalar = BigInt(h) % SECP256K1_N;

  // Q = pk_spend + h*G
  const stealthPoint   = Point.fromBytes(pkSpendBytes).add(Point.BASE.multiply(hScalar));
  const uncompressed   = stealthPoint.toBytes(false);
  const addrHash       = keccak256(toHex(uncompressed.slice(1)));
  const stealthAddress = getAddress(`0x${addrHash.slice(-40)}`) as `0x${string}`;

  if (stealthAddress.toLowerCase() !== announcedAddress.toLowerCase()) return null;

  return { stealthAddress, viewTag };
}

/** Check a PQ hybrid announcement (detect-only — no spend key needed). */
export async function checkPQAnnouncementDetect(
  skView:           `0x${string}`,
  pkSpend:          `0x${string}`,
  mlkemDecapsKey:   Uint8Array,
  ephemeralPubkey:  `0x${string}`,
  kemCiphertext:    `0x${string}`,
  announcedAddress: `0x${string}`,
  announcedViewTag: number,
): Promise<ScanHit | null> {
  const { getSharedSecret, Point } = await import("@noble/secp256k1");
  const { ml_kem768 }              = await import("@noble/post-quantum/ml-kem.js");
  const { keccak256, toHex, hexToBytes, concat, getAddress } = await import("viem");

  const skViewBytes  = hexToBytes(skView);
  const pkSpendBytes = hexToBytes(pkSpend);
  const R            = hexToBytes(ephemeralPubkey);
  const ct           = hexToBytes(kemCiphertext);

  // ECDH shared secret
  const sharedCompressed = getSharedSecret(skViewBytes, R, true);
  const sharedX          = sharedCompressed.slice(1);

  // ML-KEM decapsulation
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

  return { stealthAddress, viewTag };
}

/** Extract pkSpend and pkView from a raw meta-address (Mode A: 0x00 prefix, 67 bytes). */
export function parseMetaAddress(raw: `0x${string}`): { pkSpend: `0x${string}`; pkView: `0x${string}` } {
  const bytes = hexToBytes(raw);
  if (bytes.length === 66) {
    return {
      pkSpend: toHex(bytes.slice(0, 33)) as `0x${string}`,
      pkView:  toHex(bytes.slice(33, 66)) as `0x${string}`,
    };
  }
  if (bytes.length >= 67 && (bytes[0] === 0x00 || bytes[0] === 0x01)) {
    return {
      pkSpend: toHex(bytes.slice(1, 34)) as `0x${string}`,
      pkView:  toHex(bytes.slice(34, 67)) as `0x${string}`,
    };
  }
  throw new Error(`Unrecognized metaAddress format (${bytes.length} bytes)`);
}

/** Derive spending public key from spending private key. */
export async function privateKeyToPublicKey(sk: `0x${string}`): Promise<`0x${string}`> {
  const { getPublicKey } = await import("@noble/secp256k1");
  return toHex(getPublicKey(hexToBytes(sk), true)) as `0x${string}`;
}
