import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — must run server-side only
  serverExternalPackages: ["better-sqlite3"],
  // Required to enable instrumentation.ts
  experimental: {
    instrumentationHook: true,
  },
  // Hide the Next.js dev build indicator
  devIndicators: false,
};

export default nextConfig;
