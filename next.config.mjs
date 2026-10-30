/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The app renders raw <img> tags today, so this only takes effect if it
    // ever switches to next/image. Listed anyway so the hosts it loads from
    // are already allowed.
    remotePatterns: [
      { protocol: "https", hostname: "cdn.muapi.ai" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },

  // Keep prisma, the pg driver and the Stripe SDK out of the bundler so they
  // are loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "stripe"],
};

export default nextConfig;
