import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres is a native module — must run server-side only
  serverExternalPackages: ["postgres"],
  // Hide the Next.js dev build indicator
  devIndicators: false,
};

export default nextConfig;
