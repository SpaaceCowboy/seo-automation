import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(process.env.SEO_ASSET_PREFIX
    ? { assetPrefix: process.env.SEO_ASSET_PREFIX }
    : {}),
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ]);
  },
};
export default nextConfig;
