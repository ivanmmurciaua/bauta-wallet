/**
 * server.ts
 * HTTP API for stealth-watcher.
 *
 * GET  /health       → vault.enc exists?
 * GET  /ready        → vault.enc + RAILGUN engine fully initialized?
 * GET  /balance      → RAILGUN private balance (?chainId=...)
 * GET  /broadcaster  → Waku broadcaster ready?
 * // GET  /registered   → is this EOA+scheme registered? (?address=...&schemeId=...&chainId=...) [SCANNER NOT ACTIVE]
 * // GET  /hits         → detected payments (?address=...&schemeId=...&chainId=...) [SCANNER NOT ACTIVE]
 * // POST /register     → register a stealth account for auto-shield [SCANNER NOT ACTIVE]
 * POST /shield       → manual shield trigger
 * POST /unshield     → unshield base token to a public address
 * POST /transfer     → private transfer to a RAILGUN address
 */

import type http from "http";
import { vaultExists, defaultVaultPath } from "./vault.js";
import { isReady, vaultData } from "./start.js";
import { shieldETH, getBalances, unshieldBaseToken, privateTransfer } from "./railgun.js";
import { isBroadcasterReady } from "./broadcaster.js";
// import { upsertRegistration, getHits, isRegistered } from "./store.js"; // SCANNER NOT ACTIVE
// import { privateKeyToPublicKey } from "./detector.js"; // SCANNER NOT ACTIVE
// import { enqueueScan } from "./scanner.js"; // SCANNER NOT ACTIVE
import { DEFAULT_CHAIN_ID } from "./config.js";

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export async function router(req: http.IncomingMessage, res: http.ServerResponse) {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    res.end();
    return;
  }

  // GET /health — is the service running and vault present?
  if (method === "GET" && url === "/health") {
    return json(res, 200, { ok: true, vaultExists: vaultExists(defaultVaultPath()) });
  }

  // GET /ready — is the RAILGUN engine fully initialized?
  if (method === "GET" && url === "/ready") {
    return json(res, isReady ? 200 : 503, {
      ready: isReady,
      railgunAddress: isReady ? vaultData?.railgunAddress : null,
    });
  }

  // GET /balance — RAILGUN private balance for the loaded wallet
  if (method === "GET" && url.startsWith("/balance")) {
    if (!isReady || !vaultData) return json(res, 503, { error: "Not ready" });
    const params = new URL(url, "http://localhost").searchParams;
    const chainId = parseInt(params.get("chainId") ?? String(DEFAULT_CHAIN_ID));
    try {
      const balances = await getBalances(vaultData.railgunWalletId, chainId);
      return json(res, 200, { balances });
    } catch (err: any) {
      return json(res, 500, { error: err.message });
    }
  }

  // ── SCANNER NOT ACTIVE — uncomment when scanner is enabled ──────────────────
  // // POST /register — register account for scanning + auto-shield
  // if (method === "POST" && url === "/register") {
  //   if (!isReady) return json(res, 503, { error: "Service not ready" });
  //
  //   let body: any;
  //   try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid JSON" }); }
  //
  //   const { address, viewKey, spendKey, schemeId, mlkemDecapsKey, chainId } = body ?? {};
  //   if (!address || !viewKey || !spendKey) {
  //     return json(res, 400, { error: "Missing fields: address, viewKey, spendKey" });
  //   }
  //
  //   const scheme = String(schemeId ?? "2");
  //   if (scheme === "4" && !mlkemDecapsKey) {
  //     return json(res, 400, { error: "Missing mlkemDecapsKey for PQ scheme" });
  //   }
  //
  //   const pkSpend = await privateKeyToPublicKey(spendKey as `0x${string}`);
  //   const pkView  = await privateKeyToPublicKey(viewKey  as `0x${string}`);
  //
  //   const reg: import("./store.js").Registration = {
  //     eoaAddress:       address,
  //     skView:           viewKey,
  //     pkSpend,
  //     pkView,
  //     schemeId:         scheme,
  //     chainId:          chainId ?? DEFAULT_CHAIN_ID,
  //     ...(mlkemDecapsKey ? { mlkemDecapsKey } : {}),
  //     registeredAt:     new Date().toISOString(),
  //     scannedUpToBlock: null,
  //   };
  //
  //   upsertRegistration(reg);
  //   enqueueScan(reg); // queued historical scan — serialised to avoid RPC rate limits
  //   console.log(`[register] registered ${address} (chainId ${reg.chainId}) — scanning started`);
  //   return json(res, 200, { ok: true });
  // }
  //
  // // GET /registered — is this EOA+scheme already registered in the watcher?
  // if (method === "GET" && url.startsWith("/registered")) {
  //   const params   = new URL(url, "http://localhost").searchParams;
  //   const addr     = params.get("address");
  //   const schemeId = params.get("schemeId") ?? "2";
  //   if (!addr) return json(res, 400, { error: "Missing address param" });
  //   return json(res, 200, { registered: isRegistered(addr, schemeId) });
  // }
  //
  // // GET /hits — detected payments for an address
  // if (method === "GET" && url.startsWith("/hits")) {
  //   const params   = new URL(url, "http://localhost").searchParams;
  //   const addr     = params.get("address");
  //   const schemeId = params.get("schemeId") ?? "2";
  //   if (!addr) return json(res, 400, { error: "Missing address param" });
  //   return json(res, 200, { hits: getHits(addr, schemeId) });
  // }
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /shield — manual shield trigger
  if (method === "POST" && url === "/shield") {
    if (!isReady) return json(res, 503, { error: "Service not ready" });

    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid JSON" }); }

    const { stealthAddress, stealthPrivKey, amount, chainId } = body ?? {};
    if (!stealthAddress || !stealthPrivKey || !amount) {
      return json(res, 400, { error: "Missing fields: stealthAddress, stealthPrivKey, amount" });
    }
    if (!vaultData) return json(res, 503, { error: "Vault not loaded" });

    try {
      const txHash = await shieldETH(
        { privateKey: stealthPrivKey, address: stealthAddress },
        vaultData.railgunAddress,
        BigInt(amount),
        chainId ?? DEFAULT_CHAIN_ID,
      );
      return json(res, 200, { ok: true, txHash });
    } catch (err: any) {
      console.error(`[shield] error: ${err.message}`);
      return json(res, 500, { error: err.message });
    }
  }

  // GET /broadcaster — is Waku broadcaster ready?
  if (method === "GET" && url === "/broadcaster") {
    return json(res, 200, { ready: isBroadcasterReady });
  }

  // POST /unshield — unshield base token to a public address
  if (method === "POST" && url === "/unshield") {
    if (!isReady || !vaultData) return json(res, 503, { error: "Service not ready" });
    if (!isBroadcasterReady) return json(res, 503, { error: "Broadcaster not ready" });

    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid JSON" }); }

    const { toAddress, amount, chainId } = body ?? {};
    if (!toAddress || !amount) {
      return json(res, 400, { error: "Missing fields: toAddress, amount" });
    }

    try {
      const txHash = await unshieldBaseToken(
        vaultData.railgunWalletId,
        vaultData.railgunEncryptionKey,
        toAddress,
        BigInt(amount),
        chainId ?? DEFAULT_CHAIN_ID,
      );
      return json(res, 200, { ok: true, txHash });
    } catch (err: any) {
      const cause = err.cause?.message ?? "";
      console.error(`[unshield] error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
      return json(res, 500, { error: err.message, cause });
    }
  }

  // POST /transfer — private transfer to a RAILGUN address
  if (method === "POST" && url === "/transfer") {
    if (!isReady || !vaultData) return json(res, 503, { error: "Service not ready" });
    if (!isBroadcasterReady) return json(res, 503, { error: "Broadcaster not ready" });

    let body: any;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid JSON" }); }

    const { toRailgunAddress, tokenAddress, amount, chainId } = body ?? {};
    if (!toRailgunAddress || !tokenAddress || !amount) {
      return json(res, 400, { error: "Missing fields: toRailgunAddress, tokenAddress, amount" });
    }

    try {
      const txHash = await privateTransfer(
        vaultData.railgunWalletId,
        vaultData.railgunEncryptionKey,
        toRailgunAddress,
        tokenAddress,
        BigInt(amount),
        chainId ?? DEFAULT_CHAIN_ID,
      );
      return json(res, 200, { ok: true, txHash });
    } catch (err: any) {
      const cause = err.cause?.message ?? "";
      console.error(`[transfer] error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
      return json(res, 500, { error: err.message, cause });
    }
  }

  return json(res, 404, { error: "Not found" });
}
