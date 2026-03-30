/**
 * railgun.ts
 * RAILGUN engine bootstrap + shield / unshield / private transfer.
 */

// @ts-ignore — snarkjs has no type declarations
import { groth16 } from "snarkjs";
import {
  startRailgunEngine,
  stopRailgunEngine,
  getProver,
  ArtifactStore,
  createRailgunWallet,
  loadWalletByID,
  gasEstimateForShieldBaseToken,
  populateShieldBaseToken,
  setOnBalanceUpdateCallback,
  refreshBalances,
  gasEstimateForUnprovenUnshieldBaseToken,
  generateUnshieldBaseTokenProof,
  populateProvedUnshieldBaseToken,
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
} from "@railgun-community/wallet";
import type { RailgunBalancesEvent } from "@railgun-community/shared-models";
import type { SnarkJSGroth16 } from "@railgun-community/wallet";
import {
  NETWORK_CONFIG,
  TXIDVersion,
  EVMGasType,
} from "@railgun-community/shared-models";
import type { RailgunERC20AmountRecipient, RailgunERC20Amount } from "@railgun-community/shared-models";
import {
  findBroadcasterForToken,
  buildBroadcasterGasConfig,
  getInitialGasDetails,
  getFeeTokenDetails,
} from "./broadcaster.js";

import { Wallet } from "ethers";
import { Level } from "level";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { NETWORKS, DEFAULT_CHAIN_ID, MIN_SHIELD_AMOUNT } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(__dirname, "..", ".railgun-artifacts");
const DB_PATH      = path.join(__dirname, "..", ".railgun-db", "engine.db");

// ─── Artifact store (disk cache) ─────────────────────────────────────────────

function createArtifactStore(dir: string): ArtifactStore {
  fs.mkdirSync(dir, { recursive: true });
  return new ArtifactStore(
    async (artifactPath: string) => {
      const full = path.join(dir, artifactPath);
      if (!fs.existsSync(full)) return null;
      return fs.readFileSync(full);
    },
    async (_dirPath: string, artifactPath: string, item: string | Uint8Array) => {
      const full = path.join(dir, artifactPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, item);
    },
    async (artifactPath: string) => {
      return fs.existsSync(path.join(dir, artifactPath));
    },
  );
}

// ─── Engine init ──────────────────────────────────────────────────────────────

export async function initRailgunEngine(): Promise<void> {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Level(DB_PATH);
  const artifactStore = createArtifactStore(ARTIFACTS_DIR);

  await startRailgunEngine(
    "sovRGNop",
    db,
    false,
    artifactStore,
    false,
    false,
    ["https://ppoi-agg.horsewithsixlegs.xyz"],
    [],
    false,
  );

  getProver().setSnarkJSGroth16(groth16 as unknown as SnarkJSGroth16);

  process.on("SIGINT", async () => {
    console.log("[railgun] Shutting down engine...");
    await stopRailgunEngine();
    process.exit(0);
  });

  await addNetworks();
}

async function addNetworks(): Promise<void> {
  const { loadProvider } = await import("@railgun-community/wallet");

  // Load all supported networks into the engine
  for (const nc of Object.values(NETWORKS)) {
    await loadProvider(nc.rpcConfig, nc.railgunNetwork);
    console.log(`      Provider loaded: ${nc.railgunNetwork} (chainId ${nc.chainId})`);
  }
}

// ─── Wallet management ───────────────────────────────────────────────────────

export async function createWallet(
  mnemonic: string,
  encryptionKey: string,
): Promise<{ walletId: string; railgunAddress: string }> {
  // Include all supported networks in the creation block map
  const creationBlockMap = Object.fromEntries(
    Object.values(NETWORKS).map(nc => [
      nc.railgunNetwork,
      NETWORK_CONFIG[nc.railgunNetwork].deploymentBlock,
    ])
  );
  const info = await createRailgunWallet(encryptionKey, mnemonic, creationBlockMap);
  return { walletId: info.id, railgunAddress: info.railgunAddress };
}

export async function loadWallet(
  encryptionKey: string,
  walletId: string,
): Promise<void> {
  await loadWalletByID(encryptionKey, walletId, false);
}

// ─── Balances ─────────────────────────────────────────────────────────────────

const TOKEN_SYMBOLS: Record<string, string> = {
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14": "WETH",  // Sepolia
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": "WETH",  // Arbitrum One
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",  // Mainnet
  "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": "WMATIC", // Polygon
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC",  // Arbitrum One
};

const TOKEN_DECIMALS: Record<string, number> = {
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14": 18,
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 18,
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18,
  "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": 18,
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": 6,
};

interface TokenBalance { spendable: bigint; pending: bigint; }
let railgunBalances: Record<string, TokenBalance> = {};

export function setupBalanceCallback(): void {
  // Accept balance updates from all loaded networks
  setOnBalanceUpdateCallback((event: RailgunBalancesEvent) => {
    for (const e of event.erc20Amounts) {
      const token = e.tokenAddress.toLowerCase();
      if (!railgunBalances[token]) railgunBalances[token] = { spendable: 0n, pending: 0n };
      if (event.balanceBucket === "Spendable") {
        railgunBalances[token].spendable = e.amount;
      } else {
        railgunBalances[token].pending += e.amount;
      }
    }
  });
}

export async function getBalances(walletId: string, chainId: number = DEFAULT_CHAIN_ID): Promise<Array<{
  token: string; symbol: string; decimals: number; spendable: string; pending: string;
}>> {
  railgunBalances = {};
  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);
  const chain = NETWORK_CONFIG[nc.railgunNetwork].chain;
  await Promise.race([
    refreshBalances(chain, [walletId]),
    new Promise(r => setTimeout(r, 30_000)),
  ]);
  return Object.entries(railgunBalances).map(([token, { spendable, pending }]) => ({
    token,
    symbol:   TOKEN_SYMBOLS[token]   ?? token.slice(0, 10) + "...",
    decimals: TOKEN_DECIMALS[token]  ?? 18,
    spendable: spendable.toString(),
    pending:   pending.toString(),
  }));
}

// ─── Shield ───────────────────────────────────────────────────────────────────

export interface StealthEOA {
  privateKey: string;
  address: string;
}

export async function shieldETH(
  eoa: StealthEOA,
  railgunAddress: string,
  amount: bigint,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<string> {
  if (amount < MIN_SHIELD_AMOUNT) {
    throw new Error(`Insufficient balance to shield. Minimum: 0.01`);
  }

  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);

  const signer = new Wallet(eoa.privateKey, nc.provider);
  const shieldPrivateKey = signer.signingKey.privateKey as `0x${string}`;

  const wrappedAddress = NETWORK_CONFIG[nc.railgunNetwork].baseToken.wrappedAddress;

  const erc20AmountRecipient: RailgunERC20AmountRecipient = {
    tokenAddress: wrappedAddress,
    amount,
    recipientAddress: railgunAddress,
  };

  const gasEstimateResponse = await gasEstimateForShieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    railgunAddress,
    shieldPrivateKey,
    erc20AmountRecipient,
    signer.address,
  );
  const gasEstimate = gasEstimateResponse.gasEstimate;

  const feeData = await nc.provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? 20_000_000_000n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 1_000_000_000n;

  const gasCost = gasEstimate * maxFeePerGas;
  const buffer = gasCost / 5n; // 20% buffer
  const netAmount = amount - gasCost - buffer;

  if (netAmount <= 0n) {
    throw new Error(`Insufficient balance to cover gas. Balance: ${amount}, cost: ${gasCost}`);
  }

  // Shield txs use Type2 (EIP-1559) on all supported networks
  const shieldGasDetails = {
    evmGasType: EVMGasType.Type2,
    gasEstimate,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };

  const populateResponse = await populateShieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    railgunAddress,
    shieldPrivateKey,
    { ...erc20AmountRecipient, amount: netAmount },
    shieldGasDetails,
  );

  const transaction = populateResponse.transaction;

  const tx = await signer.sendTransaction(transaction);
  console.log(`[shield] tx sent: ${tx.hash}`);
  await tx.wait();
  console.log(`[shield] confirmed. ${netAmount} wei shielded.`);

  return tx.hash;
}

// ─── Unshield base token (ETH/MATIC) via Waku broadcaster ────────────────────

export async function unshieldBaseToken(
  walletId: string,
  encryptionKey: string,
  toAddress: string,
  amount: bigint,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<string> {
  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);

  const chain = NETWORK_CONFIG[nc.railgunNetwork].chain;
  const wrappedAddress = NETWORK_CONFIG[nc.railgunNetwork].baseToken.wrappedAddress;

  const wrappedERC20Amount: RailgunERC20Amount = {
    tokenAddress: wrappedAddress,
    amount,
  };

  // Step 1 — find broadcaster (pays fee in wrapped native token)
  const broadcaster = await findBroadcasterForToken(wrappedAddress, chainId);
  const feeTokenDetails = getFeeTokenDetails(broadcaster);
  const initialGasDetails = await getInitialGasDetails(chainId);

  // Step 2 — estimate gas
  const gasEstimateResponse = await gasEstimateForUnprovenUnshieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    toAddress,
    walletId,
    encryptionKey,
    wrappedERC20Amount,
    initialGasDetails,
    feeTokenDetails,
    false, // sendWithPublicWallet
  );
  const gasEstimate = gasEstimateResponse.gasEstimate;

  // Step 3 — build broadcaster gas config
  const { broadcasterFeeERC20AmountRecipient, overallBatchMinGasPrice, gasDetails } =
    await buildBroadcasterGasConfig(broadcaster, initialGasDetails, gasEstimate, chainId);

  // Step 4 — generate ZK proof (~5-30s)
  console.log("[unshield] generating ZK proof...");
  await generateUnshieldBaseTokenProof(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    toAddress,
    walletId,
    encryptionKey,
    wrappedERC20Amount,
    broadcasterFeeERC20AmountRecipient,
    false,
    overallBatchMinGasPrice,
    (progress: number) => {
      if (progress % 20 === 0) console.log(`[unshield] proof progress: ${progress}%`);
    },
  );

  // Step 5 — populate
  const populateResponse = await populateProvedUnshieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    toAddress,
    walletId,
    wrappedERC20Amount,
    broadcasterFeeERC20AmountRecipient,
    false,
    overallBatchMinGasPrice,
    gasDetails,
  );

  const { transaction, nullifiers, preTransactionPOIsPerTxidLeafPerList } = populateResponse;

  // Step 6 — submit via broadcaster
  const { BroadcasterTransaction } = await import(
    "@railgun-community/waku-broadcaster-client-node"
  );

  const txHash = await BroadcasterTransaction.create(
    TXIDVersion.V2_PoseidonMerkle,
    transaction.to as string,
    transaction.data as string,
    broadcaster.railgunAddress,
    broadcaster.tokenFee.feesID,
    chain,
    nullifiers ?? [],
    overallBatchMinGasPrice,
    true, // useRelayAdapt — required for unshield base token
    preTransactionPOIsPerTxidLeafPerList,
  ).then(bt => bt.send());

  console.log(`[unshield] submitted via broadcaster: ${txHash}`);
  return txHash;
}

// ─── Private transfer (RAILGUN → RAILGUN) via Waku broadcaster ───────────────

export async function privateTransfer(
  walletId: string,
  encryptionKey: string,
  toRailgunAddress: string,
  tokenAddress: string,
  amount: bigint,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<string> {
  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);

  const chain = NETWORK_CONFIG[nc.railgunNetwork].chain;

  const erc20AmountRecipient: RailgunERC20AmountRecipient = {
    tokenAddress,
    amount,
    recipientAddress: toRailgunAddress,
  };

  // Step 1 — find broadcaster (pays fee in same token)
  const broadcaster = await findBroadcasterForToken(tokenAddress, chainId);
  const feeTokenDetails = getFeeTokenDetails(broadcaster);
  const initialGasDetails = await getInitialGasDetails(chainId);

  // Step 2 — estimate gas
  const gasEstimateResponse = await gasEstimateForUnprovenTransfer(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    walletId,
    encryptionKey,
    undefined, // memoText
    [erc20AmountRecipient],
    [],         // nftAmountRecipients
    initialGasDetails,
    feeTokenDetails,
    false,      // sendWithPublicWallet
  );
  const gasEstimate = gasEstimateResponse.gasEstimate;

  // Step 3 — build broadcaster gas config
  const { broadcasterFeeERC20AmountRecipient, overallBatchMinGasPrice, gasDetails } =
    await buildBroadcasterGasConfig(broadcaster, initialGasDetails, gasEstimate, chainId);

  // Step 4 — generate ZK proof
  console.log("[transfer] generating ZK proof...");
  await generateTransferProof(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    walletId,
    encryptionKey,
    false,       // showSenderAddressToRecipient
    undefined,   // memoText
    [erc20AmountRecipient],
    [],
    broadcasterFeeERC20AmountRecipient,
    false,
    overallBatchMinGasPrice,
    (progress: number) => {
      if (progress % 20 === 0) console.log(`[transfer] proof progress: ${progress}%`);
    },
  );

  // Step 5 — populate
  const populateResponse = await populateProvedTransfer(
    TXIDVersion.V2_PoseidonMerkle,
    nc.railgunNetwork,
    walletId,
    false,
    undefined,
    [erc20AmountRecipient],
    [],
    broadcasterFeeERC20AmountRecipient,
    false,
    overallBatchMinGasPrice,
    gasDetails,
  );

  const { transaction, nullifiers, preTransactionPOIsPerTxidLeafPerList } = populateResponse;

  // Step 6 — submit via broadcaster
  const { BroadcasterTransaction } = await import(
    "@railgun-community/waku-broadcaster-client-node"
  );

  const txHash = await BroadcasterTransaction.create(
    TXIDVersion.V2_PoseidonMerkle,
    transaction.to as string,
    transaction.data as string,
    broadcaster.railgunAddress,
    broadcaster.tokenFee.feesID,
    chain,
    nullifiers ?? [],
    overallBatchMinGasPrice,
    false,
    preTransactionPOIsPerTxidLeafPerList,
  ).then(bt => bt.send());

  console.log(`[transfer] submitted via broadcaster: ${txHash}`);
  return txHash;
}
