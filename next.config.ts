import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/chat",
  // assetPrefix: "/chat", // เปิดถ้าเจอปัญหา asset path หลัง proxy
  /* config options here */
};

export default nextConfig;
