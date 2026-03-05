import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "kick.com",
      },
      {
        protocol: "https",
        hostname: "www.kick.com",
      },
      {
        protocol: "https",
        hostname: "files.kick.com",
      },
      {
        protocol: "https",
        hostname: "images.kick.com",
      },
      {
        protocol: "https",
        hostname: "clips.kick.com",
      },
      {
        protocol: "https",
        hostname: "stream.kick.com",
      },
    ],
  },
};

export default nextConfig;
