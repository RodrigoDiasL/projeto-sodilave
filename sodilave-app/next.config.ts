import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/maq-garrafoes.png",
        destination: "/maq-garrafoes",
      },
    ];
  },
};

export default nextConfig;
