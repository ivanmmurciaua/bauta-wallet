import { createConfig, fallback, http } from "wagmi";
import {
  mainnet,
  sepolia,
  arbitrum,
  base,
  optimism,
  polygon,
  gnosis,
  ink,
} from "wagmi/chains";
import { injected } from "wagmi/connectors";

const t = (urls: string[]) =>
  fallback(
    urls.map((u) => http(u)),
    { rank: false },
  );

export const config = createConfig({
  chains: [mainnet, arbitrum, base, optimism, polygon, gnosis, ink, sepolia],
  connectors: [injected()],
  transports: {
    [mainnet.id]: t([
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://rpc.ankr.com/eth",
      "https://eth.meowrpc.com",
      "https://eth.rpc.blxrbdn.com",
    ]),
    [arbitrum.id]: t([
      "https://arb1.arbitrum.io/rpc",
      "https://1rpc.io/arb",
      "https://arb-one.api.pocket.network",
      "https://arbitrum.api.onfinality.io/public",
      "https://arbitrum-one.public.blastapi.io",
      "https://rpc.ankr.com/arbitrum",
    ]),
    [base.id]: t([
      "https://1rpc.io/base",
      "https://mainnet.base.org",
      "https://rpc.ankr.com/base",
      "https://base.llamarpc.com",
      "https://base.meowrpc.com",
      "https://base.api.pocket.network",
    ]),
    [optimism.id]: t([
      "https://optimism.drpc.org",
      "https://mainnet.optimism.io",
      "https://rpc.ankr.com/optimism",
    ]),
    [polygon.id]: t([
      "https://1rpc.io/matic",
      "https://polygon-public.nodies.app",
      "https://poly.api.pocket.network",
      "https://polygon.drpc.org",
      "https://polygon-public.nodies.app",
      "https://rpc.ankr.com/polygon",
    ]),
    [gnosis.id]: t([
      "https://1rpc.io/gnosis",
      "https://rpc.gnosischain.com",
      "https://gnosis-public.nodies.app",
      "https://gnosis.api.pocket.network",
      "https://gno-mainnet.gateway.tatum.io",
      "https://rpc.ankr.com/gnosis",
    ]),
    [ink.id]: t([
      "https://ink.drpc.org",
      "https://rpc-gel.inkonchain.com",
      "https://rpc.inkonchain.com",
    ]),
    [sepolia.id]: t([
      "https://0xrpc.io/sep",
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://sepolia.drpc.org",
      // "https://rpc.sepolia.org",
    ]),
  },
});
