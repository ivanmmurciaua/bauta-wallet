import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { NetworkName } from "@railgun-community/shared-models";
import { JsonRpcProvider } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "..", "config.yaml");

interface RawConfig {
  railgunAddress: string;
  minShieldAmount: string;
  rpc: Record<string, string[]>;
}

function parseYaml(raw: string): RawConfig {
  const lines = raw.split("\n").filter((l) => !l.trimStart().startsWith("#") && l.trim());
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let subKey: string | null = null;

  for (const line of lines) {
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    const trimmed = line.trim();

    if (indent === 0 && trimmed.endsWith(":")) {
      currentKey = trimmed.slice(0, -1);
      result[currentKey] = {};
      subKey = null;
    } else if (indent === 0 && trimmed.includes(":")) {
      const [k, ...rest] = trimmed.split(":");
      result[k.trim()] = rest.join(":").trim().replace(/\s*#.*$/, "").replace(/^"(.*)"$/, "$1");
      currentKey = null;
      subKey = null;
    } else if (indent === 2 && currentKey && trimmed.endsWith(":")) {
      subKey = trimmed.slice(0, -1);
      (result[currentKey] as Record<string, unknown>)[subKey] = [];
    } else if (indent === 4 && currentKey && subKey && trimmed.startsWith("-")) {
      const val = trimmed.slice(1).trim().replace(/^"(.*)"$/, "$1");
      ((result[currentKey] as Record<string, unknown[]>)[subKey] as string[]).push(val);
    } else if (indent === 2 && currentKey && trimmed.includes(":")) {
      const [k, ...rest] = trimmed.split(":");
      (result[currentKey] as Record<string, unknown>)[k.trim()] = rest.join(":").trim().replace(/\s*#.*$/, "").replace(/^"(.*)"$/, "$1");
      subKey = null;
    }
  }

  return result as unknown as RawConfig;
}

const raw = readFileSync(CONFIG_PATH, "utf8");
const cfg = parseYaml(raw);

export const RAILGUN_ADDRESS = cfg.railgunAddress;
export const MIN_SHIELD_AMOUNT = BigInt(cfg.minShieldAmount);

// ── Supported networks ────────────────────────────────────────────────────────

export interface NetworkConfig {
  railgunNetwork: NetworkName;
  chainId: number;
  provider: JsonRpcProvider;
  rpcConfig: { chainId: number; providers: { provider: string; priority: number; weight: number }[] };
}

const NETWORK_MAP: Record<string, { railgunNetwork: NetworkName; chainId: number }> = {
  sepolia:  { railgunNetwork: NetworkName.EthereumSepolia, chainId: 11155111 },
  arbitrum: { railgunNetwork: NetworkName.Arbitrum,        chainId: 42161    },
  polygon:  { railgunNetwork: NetworkName.Polygon,         chainId: 137      },
};

function buildNetworkConfig(key: string): NetworkConfig {
  const rpcs = cfg.rpc[key];
  if (!rpcs || rpcs.length === 0) throw new Error(`No RPCs configured for network: ${key}`);
  const { railgunNetwork, chainId } = NETWORK_MAP[key];
  return {
    railgunNetwork,
    chainId,
    provider: new JsonRpcProvider(rpcs[0]),
    rpcConfig: {
      chainId,
      providers: rpcs.map((url, i) => ({ provider: url, priority: i + 1, weight: 2 })),
    },
  };
}

// All supported networks, keyed by chainId
export const NETWORKS: Record<number, NetworkConfig> = Object.fromEntries(
  Object.keys(NETWORK_MAP).map(key => {
    const nc = buildNetworkConfig(key);
    return [nc.chainId, nc];
  })
);

// Default network — Sepolia
export const DEFAULT_CHAIN_ID = 11155111;

export function getNetworkConfig(chainId: number): NetworkConfig {
  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);
  return nc;
}

// ─── RAILGUN error suppressors ────────────────────────────────────────────────

/**
 * Suppresses LevelDB LEVEL_LEGACY errors from RAILGUN internals.
 * Without this the process crashes silently on startup.
 */
export function avoidRailgunScanningErrors(): void {
  const originalStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: any, ...args: any[]) => {
    if (typeof chunk === "string" && chunk.includes("LEVEL_LEGACY")) return true;
    return originalStderr(chunk, ...args);
  };
}

/**
 * Suppresses unhandled POI refresh rejections from RAILGUN internals.
 */
export function avoidRailgunErrors(): void {
  process.on("unhandledRejection", (err: any) => {
    if (err?.message?.includes("Failed to refresh POIs")) return;
    console.error("[unhandledRejection]", err);
  });
}
