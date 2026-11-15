import type { NextConfig } from "next";

// Every screen reads live workflow state for the logged-in persona, so the app
// renders dynamically - no Cache Components / partial prefetching.
const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
