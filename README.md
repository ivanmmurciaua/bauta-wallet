# bauta

Private stealth payments on Ethereum. ERC-5564/6538 registry, post-quantum hybrid (ECDH + ML-KEM-768), RAILGUN private transfers via Waku broadcaster.

## What it does

- **Register** your stealth meta-address on-chain (ERC-6538) — classic or post-quantum mode
- **Send privately** — generate a one-time stealth address for any registered recipient, send ETH and announce via ERC-5564
- **Shield** ETH into RAILGUN from a stealth EOA
- **Unshield** ETH from RAILGUN to a public address via Waku broadcaster (zero-knowledge proof)
- **Private transfer** RAILGUN → RAILGUN via Waku broadcaster

## Post-quantum mode

Classic mode uses standard ECDH (secp256k1) for stealth address derivation. PQ mode adds ML-KEM-768 (Kyber, FIPS 203) in a hybrid scheme:

```
Classic:  h = keccak256(ECDH.x)
PQ:       h = keccak256(ECDH.x || ML-KEM shared secret)
```

The stealth address, spending key derivation, and on-chain format are identical in both modes. A quantum attacker breaking ECDH only recovers half the shared secret — without the ML-KEM component, `h` is uncomputable.

Meta-address sizes: 67 bytes (classic) vs 1251 bytes (PQ, includes 1184-byte ML-KEM encapsulation key).

## Structure

```
bauta-wallet/
  app/                  ← Next.js frontend (default port 8766)
  stealth-watcher/      ← Backend: RAILGUN engine + Waku broadcaster (default port 8765)
  lookup-standalone/    ← Standalone HTML for IPFS — no backend needed
```

## Running locally

### Frontend
```bash
npm install
npm run dev        # http://localhost:8766
```

### Watcher (first time)
```bash
cd stealth-watcher
npm install
npm run setup      # generates vault.enc + passphrase.txt
npm run start
```

### Watcher (subsequent runs)
```bash
cd stealth-watcher
npm run start
```

## Docker

Builds a single container. Frontend always starts. Watcher starts only if `vault.enc` and `passphrase.txt` exist.

```bash
# First time — setup locally to generate vault files, later, build and run
cd stealth-watcher && npm install && npm run setup && cd .. && docker compose up --build

# Subsequent runs
docker compose up
```

Ports: `8766` (frontend), `8765` (watcher, if vault present).

### Changing ports

Edit `docker-compose.yml`. Due to a docker-compose limitation, interpolation in `ports:` and `args:` is resolved on the host (not from the `environment:` block), so each port must be set in **4 places within the same file**:

```yaml
build:
  args:
    NEXT_PUBLIC_FE_PORT: "8766"        # ← 1. baked into Next.js build
    NEXT_PUBLIC_WATCHER_PORT: "8765"   # ← 2. baked into Next.js build
environment:
  FRONTEND_PORT: "8766"   # ← 3.
  PORT: "8766"            #    (same as FRONTEND_PORT, read by Next.js)
  FE_PORT: "8766"         #    (same as FRONTEND_PORT, read by watcher log)
  WATCHER_PORT: "8765"    # ← 4.
ports:
  - "8766:8766"           # ← 5. same as FRONTEND_PORT
  - "8765:8765"           # ← 6. same as WATCHER_PORT
```

After changing ports, rebuild: `docker compose up --build`.

## RPC configuration

The frontend uses wagmi's default public RPCs out of the box, but these are rate-limited and unreliable for production use. Configure your wallet (MetaMask, etc.) with private RPC endpoints for best results.

Recommended providers by use case:

| Use case | Provider | Why |
|---|---|---|
| Sending transactions, gas estimation | [Alchemy](https://www.alchemy.com) | Low latency, reliable `eth_sendRawTransaction` |
| Event scanning, `eth_getLogs` | [Infura](https://www.infura.io) | High log query limits, good archive support |
| General / fallback | [Pocket Network](https://www.pokt.network) | Decentralized, no API key required |

wagmi uses your wallet's configured RPC for gas estimation (`eth_estimateGas`). If that RPC is unresponsive, transactions will fail with `intrinsic gas too low` — this is almost always an RPC issue, not a code issue.

For the stealth-watcher backend, set `RPC_URL` in your environment or `stealth-watcher/.env` (not committed).

## Contracts (all chains — same address)

| Contract | Address |
|---|---|
| ERC-6538 Registry | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` |
| ERC-5564 Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |

## Stack

- Next.js 16, wagmi, viem
- @noble/secp256k1, @noble/post-quantum (ML-KEM-768)
- RAILGUN SDK (@railgun-community/wallet)
- Waku broadcaster (@railgun-community/waku-broadcaster-client-node)
- esbuild (lookup standalone bundler)
