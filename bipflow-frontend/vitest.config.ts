import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [
    vue({
      template: {
        transformAssetUrls: { includeAbsolute: false },
      },
    }),
  ],
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
