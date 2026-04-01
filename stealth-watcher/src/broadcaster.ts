/**
 * broadcaster.ts
 * Waku broadcaster client for RAILGUN private transactions.
 * Handles broadcaster discovery + fee calculation for unshield and private transfer.
 */

import {
  BroadcasterConnectionStatus,
  type Chain,
  type SelectedBroadcaster,
  NETWORK_CONFIG,
  type FeeTokenDetails,
  type RailgunERC20Amount,
  type RailgunERC20AmountRecipient,
  type TransactionGasDetails,
  EVMGasType,
  calculateGasPrice,
} from "@railgun-community/shared-models";
import { calculateBroadcasterFeeERC20Amount } from "@railgun-community/wallet";
import { NETWORKS, DEFAULT_CHAIN_ID } from "./config.js";

// ─── State ───────────────────────────────────────────────────────────────────

export let isBroadcasterReady = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initializeBroadcasters(chainId: number = DEFAULT_CHAIN_ID): Promise<void> {
  const { WakuBroadcasterClient } = await import(
    "@railgun-community/waku-broadcaster-client-node"
  );

  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);
  const chain = NETWORK_CONFIG[nc.railgunNetwork].chain;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Waku broadcaster connection timeout (90s)"));
    }, 90_000);

    WakuBroadcasterClient.start(
      chain,
      { trustedFeeSigner: "" },
      (_ch: Chain, status: BroadcasterConnectionStatus) => {
        if (status === BroadcasterConnectionStatus.Connected) {
          clearTimeout(timeout);
          isBroadcasterReady = true;
          resolve();
        } else if (status === BroadcasterConnectionStatus.Error) {
          clearTimeout(timeout);
          isBroadcasterReady = false;
          reject(new Error("Waku broadcaster error"));
        }
        // Searching / Disconnected / AllUnavailable → keep waiting
      },
      {
        log: (_msg: string) => { /* suppress verbose waku logs */ },
        error: (err: Error) => console.error(`[waku] ${err.message}`),
      },
    );
  });
}

// ─── Broadcaster discovery ────────────────────────────────────────────────────

export async function findBroadcasterForToken(
  tokenAddress: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<SelectedBroadcaster> {
  const { WakuBroadcasterClient } = await import(
    "@railgun-community/waku-broadcaster-client-node"
  );

  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);
  const chain = NETWORK_CONFIG[nc.railgunNetwork].chain;

  // Switch Waku observers to the requested chain before searching
  await WakuBroadcasterClient.setChain(chain);
  await WakuBroadcasterClient.findAllBroadcastersForChain(chain, false);

  const broadcaster = WakuBroadcasterClient.findBestBroadcaster(
    chain,
    tokenAddress,
    false,
  );

  if (!broadcaster) {
    throw new Error(`No broadcaster available for token ${tokenAddress}`);
  }
  return broadcaster;
}

// ─── Fee helpers ──────────────────────────────────────────────────────────────

export interface BroadcasterGasConfig {
  broadcasterFeeERC20AmountRecipient: RailgunERC20AmountRecipient;
  overallBatchMinGasPrice: bigint;
  gasDetails: TransactionGasDetails;
}

/**
 * Given a broadcaster + estimated gas, returns the fee recipient + gas config
 * needed for generateProof and populateProved calls.
 */
export async function buildBroadcasterGasConfig(
  broadcaster: SelectedBroadcaster,
  initialGasDetails: TransactionGasDetails,
  gasEstimate: bigint,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<BroadcasterGasConfig> {
  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);

  const gasDetails: TransactionGasDetails = { ...initialGasDetails, gasEstimate };

  const feeTokenDetails: FeeTokenDetails = {
    tokenAddress: broadcaster.tokenAddress,
    feePerUnitGas: BigInt(broadcaster.tokenFee.feePerUnitGas),
  };

  const feeAmount: RailgunERC20Amount =
    calculateBroadcasterFeeERC20Amount(feeTokenDetails, gasDetails);

  const broadcasterFeeERC20AmountRecipient: RailgunERC20AmountRecipient = {
    ...feeAmount,
    recipientAddress: broadcaster.railgunAddress,
  };

  const overallBatchMinGasPrice = calculateGasPrice(gasDetails);

  return { broadcasterFeeERC20AmountRecipient, overallBatchMinGasPrice, gasDetails };
}

/**
 * Initial gas details for the first estimation pass (gasEstimate = 0n placeholder).
 * Broadcaster txs always use Type1 — the SDK enforces this regardless of network
 * because overallBatchMinGasPrice is only supported by Type1 transactions.
 */
export async function getInitialGasDetails(chainId: number = DEFAULT_CHAIN_ID): Promise<TransactionGasDetails> {
  const nc = NETWORKS[chainId];
  if (!nc) throw new Error(`Unsupported chainId: ${chainId}`);

  const feeData = await nc.provider.getFeeData();
  return {
    evmGasType: EVMGasType.Type1,
    gasEstimate: 0n,
    gasPrice: feeData.gasPrice ?? 0n,
  };
}

export function getFeeTokenDetails(broadcaster: SelectedBroadcaster): FeeTokenDetails {
  return {
    tokenAddress: broadcaster.tokenAddress,
    feePerUnitGas: BigInt(broadcaster.tokenFee.feePerUnitGas),
  };
}
