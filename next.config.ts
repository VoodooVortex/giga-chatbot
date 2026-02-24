import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/chat",
  assetPrefix: "/chat",
  images: {
    unoptimized: true,
  },
  /* config options here */
};

export default nextConfig;
