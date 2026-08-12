import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pokemontcg.io",
      },
      {
        // pokemontcg.io serves some newer cards' images from this CDN
        // instead of images.pokemontcg.io -- without both allowed,
        // next/image throws on any card using the other host, which
        // crashes the whole page render (not just that one image).
        protocol: "https",
        hostname: "images.scrydex.com",
      },
    ],
  },
};

export default nextConfig;
