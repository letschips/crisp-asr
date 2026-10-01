import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyLicenseCode } from "../src/license";
import { installLocalTrustAnchor, restoreTrustAnchor, trustedCode, untrustedCode } from "./local-license-fixture";

// 密钥轮换完成后的授权测试：
// - 新私钥签发的授权码必须通过
// - 旧私钥签发的授权码必须被拒绝（旧公钥已移除）
// - 被篡改的授权码必须失败
// 授权码由本进程生成的本地密钥签发（见 local-license-fixture.ts），不使用任何真实授权码。
const NEW_SIGNED_CODE = trustedCode();
const OLD_SIGNED_CODE = untrustedCode();

describe("license key rotation (legacy key removed)", () => {
  beforeAll(() => {
    // Node 测试环境补齐 window，验签使用 Node WebCrypto (Ed25519)
    (globalThis as unknown as { window: unknown }).window = globalThis;
    installLocalTrustAnchor();
  });

  afterAll(() => restoreTrustAnchor());

  it("accepts codes signed with the new key", async () => {
    const result = await verifyLicenseCode(NEW_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(true);
  });

  it("rejects codes signed with the removed legacy key", async () => {
    const result = await verifyLicenseCode(OLD_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(false);
  });

  it("rejects tampered codes", async () => {
    const tampered = OLD_SIGNED_CODE.slice(0, -1) + "A";
    const result = await verifyLicenseCode(tampered, "crisp-asr");
    expect(result.valid).toBe(false);
  });
});
