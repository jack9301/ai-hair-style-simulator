import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";

// OpenNext Cloudflare config.
// By default, OpenNext uses no incremental cache ("dummy") — every request re-runs the
// server component. That's fine for this app because we don't use ISR or `unstable_cache`.
// If you later want ISR, add a `NEXT_INC_CACHE_KV` KV namespace binding in wrangler.jsonc
// and swap `incrementalCache` for `kvIncrementalCache` (already imported above).
//
// See https://opennext.js.org/cloudflare/caching for the KV/R2 cache setup.
export default defineCloudflareConfig({
  // `enableCacheInterception` is false by default. The app doesn't use PPR, so leave it off.
  // `routePreloadingBehavior` defaults to "none", which is the safest CPU profile.
});
