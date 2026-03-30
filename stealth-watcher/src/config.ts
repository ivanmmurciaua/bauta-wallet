import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { NetworkName } from "@railgun-community/shared-models";
import { JsonRpcProvider } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "..", "config.yaml");

interface RawConfig {
  network: string;
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

export const NETWORK = cfg.network as "mainnet" | "sepolia" | "arbitrum";
export const RAILGUN_ADDRESS = cfg.railgunAddress;
export const MIN_SHIELD_AMOUNT = BigInt(cfg.minShieldAmount);

export const RAILGUN_NETWORK: NetworkName =
  NETWORK === "mainnet" ? NetworkName.Ethereum :
  NETWORK === "arbitrum" ? NetworkName.Arbitrum :
  NetworkName.EthereumSepolia;

const rpcs = cfg.rpc[NETWORK] ?? [];
if (rpcs.length === 0) throw new Error(`No RPCs configured for network: ${NETWORK}`);

export const PROVIDER = new JsonRpcProvider(rpcs[0]);

export const RPC_CONFIG = {
  chainId:
    NETWORK === "mainnet" ? 1 :
    NETWORK === "arbitrum" ? 42161 :
    11155111,
  providers: rpcs.map((url, i) => ({ provider: url, priority: i + 1, weight: 2 })),
};

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
