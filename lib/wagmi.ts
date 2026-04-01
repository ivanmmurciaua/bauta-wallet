import { createConfig, http } from "wagmi";
import { sepolia, arbitrum, polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [sepolia, arbitrum, polygon],
  connectors: [injected()],
  transports: {
    [sepolia.id]:  http(),
    [arbitrum.id]: http(),
    [polygon.id]:  http(),
  },
});
