import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("production bundle", () => {
  it("ships the Node WebSocket client required for authenticated handshakes", () => {
    execFileSync(
      process.execPath,
      ["esbuild.config.mjs", "production"],
      { cwd: projectRoot, stdio: "pipe" },
    );

    const bundle = readFileSync(resolve(projectRoot, "main.js"), "utf8");
    expect(bundle).not.toContain("ws does not work in the browser");
    expect(bundle).toContain("Sec-WebSocket-Key");
  });
});
