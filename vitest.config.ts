import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ashfall/shared": r("./packages/shared/src/index.ts"),
      "@ashfall/engine": r("./packages/engine/src/index.ts"),
      "@ashfall/bots": r("./packages/bots/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "packages/client/**"],
    testTimeout: 30_000,
  },
});
