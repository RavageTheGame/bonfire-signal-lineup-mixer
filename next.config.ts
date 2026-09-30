import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://www.notion.so https://notion.so https://*.notion.so https://*.notion.com https://*.notion.site;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
