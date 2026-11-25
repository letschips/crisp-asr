// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installLocalTrustAnchor, restoreTrustAnchor, trustedCode, untrustedCode } from "./local-license-fixture";

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestUrl: requestUrlMock,
}));

let api: typeof import("../src/license");
let CrispAsrPlugin: typeof import("../src/main").default;

const NBSP = String.fromCharCode(0xa0);
const FULLWIDTH = String.fromCharCode(0x3000);
const ZWSP = String.fromCharCode(0x200b);

function approveAll(): void {
  requestUrlMock.mockImplementation(async () => ({ status: 200, json: { valid: true } }));
}
function sentCodes(): string[] {
  return requestUrlMock.mock.calls.map((call) => JSON.parse((call[0] as { body: string }).body).licenseCode as string);
}
function fakeApp(files: Record<string, string>, loaded: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vault: {
      configDir: ".cfg",
      adapter: {
        exists: async (path: string) => path in files,
        read: async (path: string) => files[path],
      },
    },
    plugins: { plugins: loaded },
  };
}

describe("license paste normalization and sibling inheritance", () => {
  beforeAll(async () => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    installLocalTrustAnchor();
    api = await import("../src/license");
    CrispAsrPlugin = (await import("../src/main")).default;
  });
  afterAll(() => restoreTrustAnchor());

  it("verifies mangled pastes like the clean code and sends the clean code to the server", async () => {
    const clean = trustedCode();
    const mid = Math.floor(clean.length / 2);
    const variants = [
      `${clean.slice(0, mid)}\n${clean.slice(mid)}`,
      `${clean.slice(0, mid)}\r\n${clean.slice(mid)}`,
      `${clean.slice(0, 20)} ${clean.slice(20)}`,
      `${clean.slice(0, 20)}${FULLWIDTH}${clean.slice(20)}`,
      `${clean.slice(0, 20)}${NBSP}${clean.slice(20)}`,
      `${clean.slice(0, 20)}${ZWSP}${clean.slice(20)}`,
      `卡密：${clean}。`,
      `${clean}\n复制卡密发送给买家`,
    ];
    for (const variant of variants) {
      requestUrlMock.mockReset();
      approveAll();
      expect((await api.verifyLicenseCode(variant)).valid).toBe(true);
      expect(sentCodes()).toEqual([clean]);
    }
  });

  it("leaves a clean code unchanged and keeps junk invalid with the same reasons", async () => {
    const clean = trustedCode();
    expect(api.normalizeLicenseCode(clean)).toBe(clean);
    expect(api.normalizeLicenseCode(undefined)).toBe("");
    expect((await api.verifyLicenseCode("")).reason).toBe("授权码为空");
    expect((await api.verifyLicenseCode("  \n ")).reason).toBe("授权码为空");
    expect((await api.verifyLicenseCode("hello world")).reason).toContain("格式无效");
    expect((await api.verifyLicenseCode(untrustedCode())).valid).toBe(false);
  });

  it("inherits a sibling code and the plugin persists the clean code", async () => {
    requestUrlMock.mockReset();
    approveAll();
    const code = trustedCode();
    const app = fakeApp({ ".cfg/plugins/crisp-tempo/data.json": JSON.stringify({ licenseKey: `卡密：${code}。` }) });
    const plugin = new CrispAsrPlugin(app as never, { id: "crisp-asr" } as never);
    plugin.settings.licenseCode = "";
    const persist = vi.spyOn(plugin as unknown as { persistSettings(): Promise<boolean> }, "persistSettings").mockResolvedValue(true);
    await (plugin as unknown as { inheritSiblingLicenseOnce(): Promise<void> }).inheritSiblingLicenseOnce();
    expect(plugin.settings.licenseCode).toBe(code);
    expect(persist).toHaveBeenCalled();
  });

  it("does not scan or overwrite a still-valid own code", async () => {
    requestUrlMock.mockReset();
    approveAll();
    const own = trustedCode([ "all" ], { licenseId: "OWN" });
    const sibling = trustedCode([ "all" ], { licenseId: "SIBLING" });
    const app = fakeApp({ ".cfg/plugins/crisp-tempo/data.json": JSON.stringify({ licenseKey: sibling }) });
    const plugin = new CrispAsrPlugin(app as never, { id: "crisp-asr" } as never);
    plugin.settings.licenseCode = own;
    const persist = vi.spyOn(plugin as unknown as { persistSettings(): Promise<boolean> }, "persistSettings").mockResolvedValue(true);
    await (plugin as unknown as { inheritSiblingLicenseOnce(): Promise<void> }).inheritSiblingLicenseOnce();
    expect(plugin.settings.licenseCode).toBe(own);
    expect(sentCodes()).toEqual([own]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("replaces an own code the server rejects with a sibling code that passes", async () => {
    requestUrlMock.mockReset();
    const own = trustedCode([ "all" ], { licenseId: "OWN-REVOKED" });
    const sibling = trustedCode([ "all" ], { licenseId: "SIBLING-OK" });
    requestUrlMock.mockImplementation(async (options: { body: string }) => {
      const sent = JSON.parse(options.body).licenseCode as string;
      return { status: 200, json: sent === own ? { valid: false, reason: "revoked" } : { valid: true } };
    });
    const app = fakeApp({ ".cfg/plugins/crisp-tempo/data.json": JSON.stringify({ licenseKey: sibling }) });
    const plugin = new CrispAsrPlugin(app as never, { id: "crisp-asr" } as never);
    plugin.settings.licenseCode = own;
    vi.spyOn(plugin as unknown as { persistSettings(): Promise<boolean> }, "persistSettings").mockResolvedValue(true);
    await (plugin as unknown as { inheritSiblingLicenseOnce(): Promise<void> }).inheritSiblingLicenseOnce();
    expect(plugin.settings.licenseCode).toBe(sibling);
  });

  it("does not persist a sibling code the server rejects", async () => {
    requestUrlMock.mockReset();
    requestUrlMock.mockImplementation(async () => ({ status: 200, json: { valid: false, reason: "revoked" } }));
    const app = fakeApp({ ".cfg/plugins/crisp-tempo/data.json": JSON.stringify({ licenseKey: trustedCode() }) });
    const plugin = new CrispAsrPlugin(app as never, { id: "crisp-asr" } as never);
    plugin.settings.licenseCode = "";
    const persist = vi.spyOn(plugin as unknown as { persistSettings(): Promise<boolean> }, "persistSettings").mockResolvedValue(true);
    await (plugin as unknown as { inheritSiblingLicenseOnce(): Promise<void> }).inheritSiblingLicenseOnce();
    expect(plugin.settings.licenseCode).toBe("");
    expect(persist).not.toHaveBeenCalled();
  });

  it("never sends forged or other-product sibling codes to the server", async () => {
    requestUrlMock.mockReset();
    approveAll();
    const app = fakeApp({
      ".cfg/plugins/crisp-pulse/data.json": JSON.stringify({ licenseCode: untrustedCode() }),
      ".cfg/plugins/crisp-tempo/data.json": JSON.stringify({ licenseKey: trustedCode(["crisp-focus"], { product: "Crisp Focus" }) }),
    });
    expect([...(await api.discoverVaultCrispLicenses(app, "crisp-asr"))]).toEqual([]);
    expect(requestUrlMock).not.toHaveBeenCalled();
  });
});
