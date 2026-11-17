import { afterEach, describe, expect, it, vi } from "vitest";

// Hardening: the verifier is taken once at load and must reject an all-zero signature, so a
// console patch of crypto.subtle cannot make a forged code pass.
(globalThis as unknown as { window: unknown }).window = globalThis;

function forgedCode(): string {
  const payload = Buffer.from(JSON.stringify({
    product: "Crisp Suite", licenseId: "FORGED", userName: "x",
    expiresAt: "2999-01-01T00:00:00.000Z", features: ["all"],
  })).toString("base64url");
  return `${payload}.${Buffer.alloc(64).toString("base64url")}`;
}

describe("license verifier hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("replacing crypto.subtle.verify after load cannot pass a forged code", async () => {
    const { verifyLicenseCode } = await import("../src/license");
    vi.spyOn(globalThis.crypto.subtle, "verify").mockResolvedValue(true);
    expect((await verifyLicenseCode(forgedCode(), "crisp-asr")).valid).toBe(false);
  });

  it("a verifier that accepts everything at load is not trusted, so no code passes", async () => {
    vi.spyOn(globalThis.crypto.subtle, "verify").mockResolvedValue(true);
    const { verifyLicenseCode } = await import("../src/license");
    expect((await verifyLicenseCode(forgedCode(), "crisp-asr")).valid).toBe(false);
  });
});
