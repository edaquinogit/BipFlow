import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  // Vite's plugin-vue integration sets transformAssetUrls.includeAbsolute = true
  // so `base` can be prepended to `/public` asset URLs at build time. Under
  // Vitest there is no asset pipeline, so an absolute `<img src="/brand/..">`
  // becomes an unresolvable `import "/brand/.."` and the module runner throws
  // ERR_INVALID_ARG_VALUE. These are public-dir assets served verbatim at that
  // path, so keeping the URL as a literal string is correct for the test env.
  plugins: [vue({ template: { transformAssetUrls: { includeAbsolute: false } } })],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    globals: true,
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: "src/tests/setupTests.ts",
    coverage: { provider: "v8" },
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx", "src/**/*.spec.vue"],
  },
});
