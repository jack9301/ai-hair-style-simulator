/** @type {import('next').NextConfig} */
const nextConfig = {
  // OpenNext Cloudflare builds the standalone output itself; keep Next defaults otherwise.
  // The build output is consumed by `opennextjs-cloudflare build`, not `next start`.
  images: {
    // All <img> usage in this project uses raw <img> tags (eslint-disabled).
    // Keep Next image optimization OFF so Cloudflare can serve CDN assets directly
    // without needing a loader. Re-enable with `unoptimized: false` and a Cloudflare
    // Images loader if you decide to migrate to next/image.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "cdn.muapi.ai" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },

  // Make sure server actions & route handlers can read env vars set in Cloudflare.
  // OpenNext injects `process.env` from the bindings at runtime, but we also tell
  // Next not to inline anything that would break the build on Workers.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "stripe"],
};

export default nextConfig;
