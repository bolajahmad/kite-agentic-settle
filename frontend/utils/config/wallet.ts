import { QueryClient } from "@tanstack/react-query";
import {
  cookieStorage,
  createConfig,
  createStorage,
  http,
  injected,
} from "wagmi";

export const kiteOzone = {
   id: 2368,
  name: 'Kite Ozone Testnet',
  nativeCurrency: { name: 'KITE', symbol: 'KITE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-testnet.gokite.ai'] },
  },
  blockExplorers: {
    default: { name: 'Kite Explorer', url: 'https://explorer-testnet.gokite.ai' },
  },
  testnet: true,
} as const;

export const kiteMainnet = {
   id: 2366,
  name: 'KiteAI Mainnet',
  nativeCurrency: { name: 'KITE', symbol: 'KITE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.gokite.ai'] },
  },
  blockExplorers: {
    default: { name: 'Kite Explorer', url: 'https://kitescan.ai/' },
  },
  testnet: false,
} as const;

export function getConfig() {
  return createConfig({
    chains: [kiteOzone, kiteMainnet],
    storage: createStorage({
      storage: cookieStorage,
    }),
    ssr: true,
    connectors: [injected()],
    transports: {
      [kiteOzone.id]: http(),
      [kiteMainnet.id]: http(),
    },
  });
}

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof getConfig>;
  }
}


export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retryOnMount: true,
      staleTime: 2 * 1000 * 60, // 2 minute
    }
  }
});