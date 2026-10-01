import { generateKeyPairSync, sign } from "node:crypto";
import { vi } from "vitest";

// 授权测试用的本地信任锚。
//
// 授权码只能由本进程临时生成的 Ed25519 密钥对签发，绝不使用生产私钥签发的真实授权码——
// 本仓库是公开的，写进测试的授权码等于公开发放。src/license.ts 的公钥是写死的常量，
// 所以这里让 WebCrypto 在导入该公钥时改用本地公钥，其余校验（签名、有效期、权限）仍走真实实现。
const trusted = generateKeyPairSync("ed25519");
const untrusted = generateKeyPairSync("ed25519");
const trustedSpki = trusted.publicKey.export({ type: "spki", format: "der" });

export function installLocalTrustAnchor(): void {
  const subtle = (globalThis as unknown as { crypto: { subtle: SubtleCrypto } }).crypto.subtle;
  const original = subtle.importKey.bind(subtle) as (...args: unknown[]) => Promise<CryptoKey>;
  vi.spyOn(subtle, "importKey").mockImplementation(((format: unknown, keyData: unknown, ...rest: unknown[]) =>
    original(format, format === "spki" ? trustedSpki : keyData, ...rest)) as unknown as typeof subtle.importKey);
}

export function restoreTrustAnchor(): void {
  vi.restoreAllMocks();
}

function encode(features: string[], overrides: Record<string, unknown>, key: typeof trusted.privateKey): string {
  const payload = Buffer.from(JSON.stringify({
    product: "Crisp Suite",
    licenseId: "LOCAL-ASR-TEST",
    userName: "local-tester",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    features,
    ...overrides,
  })).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(payload), key).toString("base64url")}`;
}

/** 由受信任的本地密钥签发。 */
export function trustedCode(features: string[] = ["all"], overrides: Record<string, unknown> = {}): string {
  return encode(features, overrides, trusted.privateKey);
}

/** 由另一把不受信任的密钥签发，模拟已被移除的旧密钥。 */
export function untrustedCode(features: string[] = ["all"], overrides: Record<string, unknown> = {}): string {
  return encode(features, overrides, untrusted.privateKey);
}
