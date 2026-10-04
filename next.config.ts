import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "dist",
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_CONVEX_URL: process.env.VITE_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
  },
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
