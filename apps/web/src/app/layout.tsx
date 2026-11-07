import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "Waybill",
  description: "Track a NEAR Intents swap leg by leg, from independent sources, and get a case file when it stalls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <header className="mx-auto flex max-w-4xl items-center justify-between px-4 pt-6 sm:px-6">
          <Link href="/" className="font-mono text-sm font-semibold tracking-[0.2em] uppercase">
            Waybill
          </Link>
          <nav aria-label="Main" className="flex gap-5 font-mono text-xs text-muted">
            <Link href="/" className="hover:text-ink">
              Track a swap
            </Link>
            <Link href="/routes" className="hover:text-ink">
              Route reliability
            </Link>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>
        <footer className="mx-auto max-w-4xl px-4 pb-10 font-mono text-xs leading-relaxed text-muted sm:px-6">
          Waybill reads public chains and NEAR Intents APIs. It holds no keys and moves no money.
        </footer>
      </body>
    </html>
  );
}
