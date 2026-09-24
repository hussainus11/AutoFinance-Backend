import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.integration.test.ts"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./tests/setup-integration-env.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Integration tests share one DB and mutate shared tables (User/RefreshToken) —
    // run them serially to avoid cross-test interference.
    fileParallelism: false
  }
});
