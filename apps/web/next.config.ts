import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The monorepo keeps one .env.local at the repository root (NEAR_INTENTS_JWT). forceReload makes
// Next.js read the root directory as well as apps/web.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  // The pre-send check reads the route snapshot at request time, so it must ship with that function.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: { "/check/[address]": ["../../data/routes/snapshot.json.gz"] },
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@waybill/core"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
