import { sepolia, arbitrum, polygon } from "viem/chains";
import type { Chain } from "viem";

// ── Supported chains ──────────────────────────────────────────────────────────

export interface ChainConfig {
  chain:    Chain;
  label:    string;
  explorer: string; // base tx URL: explorer + "/tx/" + hash
  testnet:  boolean;
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  { chain: arbitrum, label: "Arbitrum", explorer: "https://arbiscan.io",          testnet: false },
  { chain: polygon,  label: "Polygon",  explorer: "https://polygonscan.com",      testnet: false },
  { chain: sepolia,  label: "Sepolia",  explorer: "https://sepolia.etherscan.io", testnet: true  },
];

export const CHAIN_BY_ID: Record<number, ChainConfig> = Object.fromEntries(
  SUPPORTED_CHAINS.map(c => [c.chain.id, c])
);

export const DEFAULT_CHAIN_ID = sepolia.id;

// ── ERC-6538 Registry (same address on all chains) ────────────────────────────
// Source: https://eips.ethereum.org/EIPS/eip-6538
export const STEALTH_REGISTRY_ADDRESS =
  "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538" as `0x${string}`;

// ── ERC-5564 Announcer (same address on all chains) ───────────────────────────
// Source: https://eips.ethereum.org/EIPS/eip-5564
export const STEALTH_ANNOUNCER_ADDRESS =
  "0x55649E01B5Df198D18D95b5cc5051630cfD45564" as `0x${string}`;

export const STEALTH_ANNOUNCER_ABI = [
  {
    type: "function",
    name: "announce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schemeId",        type: "uint256" },
      { name: "stealthAddress",  type: "address" },
      { name: "ephemeralPubKey", type: "bytes"   },
      { name: "metadata",        type: "bytes"   },
    ],
    outputs: [],
  },
] as const;

// ── SchemeIds ─────────────────────────────────────────────────────────────────
export const SCHEME_ID_CLASSIC = 2n;
export const SCHEME_ID_PQ      = 4n;

// ── Scan window ───────────────────────────────────────────────────────────────
export const ANNOUNCEMENT_SCAN_BLOCKS = 20_000n;

// ── Dust filter ───────────────────────────────────────────────────────────────
export const MIN_STEALTH_BALANCE = 10_000_000_000_000n; // 0.00001 ETH

// ── stealth-watcher backend ───────────────────────────────────────────────────
export const WATCHER_URL = `http://localhost:${process.env.NEXT_PUBLIC_WATCHER_PORT ?? "8765"}`;
