/**
 * derive.ts
 * Deterministic key derivation from a BIP-39 mnemonic.
 *
 * Stealth keys (ERC-5564):
 *   m/44'/60'/0'/0/0  → spend key
 *   m/44'/60'/0'/0/1  → view key
 *
 * RAILGUN encryption key:
 *   keccak256("railgun-enc:" + spend_key) — deterministic, never stored separately
 */

import { HDNodeWallet, Mnemonic, keccak256, toUtf8Bytes, hexlify, concat } from "ethers";

export interface DerivedKeys {
  spendKey: string;          // hex private key
  spendAddress: string;      // 0x... EOA address
  viewKey: string;           // hex private key
  viewAddress: string;       // 0x... EOA address
  railgunEncryptionKey: string; // 32-byte hex, used to encrypt wallet in LevelDB
}

export function deriveKeysFromMnemonic(mnemonic: string): DerivedKeys {
  const mnemonicObj = Mnemonic.fromPhrase(mnemonic);

  const spendWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/0");
  const viewWallet  = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/1");

  const spendKey = spendWallet.privateKey;
  const viewKey  = viewWallet.privateKey;

  // Deterministic encryption key — derived from spend key, never needs to be stored separately
  // .slice(2) removes 0x prefix: RAILGUN expects 64 hex chars (32 bytes), not 66
  const railgunEncryptionKey = keccak256(
    concat([toUtf8Bytes("railgun-enc:"), hexlify(spendKey)])
  ).slice(2);

  return {
    spendKey,
    spendAddress: spendWallet.address,
    viewKey,
    viewAddress: viewWallet.address,
    railgunEncryptionKey,
  };
}
