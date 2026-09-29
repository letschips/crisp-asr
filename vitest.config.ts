import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  assetsInclude: ["**/*.png"],
  resolve: {
    alias: {
      obsidian: fileURLToPath(
        new URL("./tests/obsidian-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Fixtures use UTC timestamps; pin the zone so local-time rendering is
    // deterministic. Individual tests override TZ to prove local behaviour.
    env: { TZ: "UTC" },
  },
});
