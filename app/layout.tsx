import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { PQToggle } from "@/components/PQToggle";
import { WalletStatus } from "@/components/WalletStatus";
import { ChainSelector } from "@/components/ChainSelector";
import "./globals.css";

export const metadata: Metadata = {
  title: "bauta.wallet",
  description: "Stealth addresses — privacy by default",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <WalletStatus />
          <ChainSelector />
          <PQToggle />
          {children}
        </Providers>
      </body>
    </html>
  );
}
