import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The monorepo keeps one .env.local at the repository root (NEAR_INTENTS_JWT). forceReload makes
// Next.js read the root directory as well as apps/web.
loadEnvConfig(fileURLToPath(new URL("../..", import.meta.url)), process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@waybill/core"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
