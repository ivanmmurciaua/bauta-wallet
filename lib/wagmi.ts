import { createConfig, http } from "wagmi";
import { mainnet, sepolia, arbitrumSepolia, base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [mainnet, sepolia, arbitrumSepolia, base, baseSepolia],
  connectors: [injected()],
  transports: {
    [mainnet.id]:         http(),
    [sepolia.id]:         http(),
    [arbitrumSepolia.id]: http(),
    [base.id]:            http(),
    [baseSepolia.id]:     http(),
  },
});
