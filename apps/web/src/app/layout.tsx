import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

const DESCRIPTION =
  "Check a NEAR Intents deposit address before you send, track every leg of the swap on the chains themselves, and get a case file when it stalls.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3020"),
  title: "Waybill",
  description: DESCRIPTION,
  openGraph: { title: "Waybill: where is my swap?", description: DESCRIPTION, siteName: "Waybill", type: "website" },
  twitter: { card: "summary_large_image", title: "Waybill: where is my swap?", description: DESCRIPTION },
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
