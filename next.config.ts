import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk', '@google-cloud/vertexai'],
};

export default nextConfig;
