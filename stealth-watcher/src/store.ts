import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "data", "store.json");

export interface Registration {
  eoaAddress:       string;
  skView:           string;   // viewing private key
  pkSpend:          string;   // spending PUBLIC key
  pkView:           string;   // viewing PUBLIC key
  schemeId:         string;   // "2" = classic, "4" = PQ
  mlkemDecapsKey?:  string;   // hex-encoded, PQ only (2400 bytes = 4800 hex chars)
  registeredAt:     string;
  scannedUpToBlock: string | null;
}

export interface PaymentHit {
  stealthAddress: string;
  blockNumber:    string;
  txHash:         string;
  schemeId:       string;
  detectedAt:     string;
  balance:        string; // wei at detection time
}

interface StoreData {
  registrations: Record<string, Registration>;
  hits:          Record<string, PaymentHit[]>;
}

let store: StoreData = { registrations: {}, hits: {} };

/** Composite key: eoa-schemeId — allows same address in classic + PQ simultaneously */
function regKey(eoaAddress: string, schemeId: string): string {
  return `${eoaAddress.toLowerCase()}-${schemeId}`;
}

function ensureDataDir() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadStore(): void {
  ensureDataDir();
  if (!fs.existsSync(DATA_PATH)) return;
  try {
    store = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) as StoreData;
  } catch {
    console.error("[store] Failed to parse store.json — starting fresh");
  }
}

export function saveStore(): void {
  ensureDataDir();
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export function getAllRegistrations(): Registration[] {
  return Object.values(store.registrations);
}

export function resetAllCheckpoints(): void {
  for (const key of Object.keys(store.registrations)) {
    store.registrations[key].scannedUpToBlock = null;
  }
  saveStore();
}

export function isRegistered(eoaAddress: string, schemeId: string): boolean {
  return !!store.registrations[regKey(eoaAddress, schemeId)];
}

export function upsertRegistration(reg: Registration): void {
  store.registrations[regKey(reg.eoaAddress, reg.schemeId)] = reg;
  saveStore();
}

export function setUserScannedBlock(eoaAddress: string, schemeId: string, block: bigint): void {
  const key = regKey(eoaAddress, schemeId);
  if (store.registrations[key]) {
    store.registrations[key].scannedUpToBlock = block.toString();
    saveStore();
  }
}

export function getHits(eoaAddress: string, schemeId: string): PaymentHit[] {
  return store.hits[regKey(eoaAddress, schemeId)] ?? [];
}

export function addHit(eoaAddress: string, schemeId: string, hit: PaymentHit): void {
  const key = regKey(eoaAddress, schemeId);
  if (!store.hits[key]) store.hits[key] = [];
  const exists = store.hits[key].some(
    h => h.txHash === hit.txHash && h.stealthAddress === hit.stealthAddress,
  );
  if (!exists) {
    store.hits[key].push(hit);
    saveStore();
  }
}
