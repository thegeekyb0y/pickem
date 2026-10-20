import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end suite drives the dev server through the loopback address,
  // which the dev server otherwise treats as a cross-origin request.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
