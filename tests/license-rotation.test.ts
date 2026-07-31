import { beforeAll, describe, expect, it } from "vitest";
import { verifyLicenseCode } from "../src/license";

// 过渡期双公钥轮换测试：
// - 新私钥签发的授权码必须通过（新公钥主验签）
// - 旧私钥签发的存量授权码必须通过（旧公钥兜底）
// - 被篡改的授权码必须失败
const NEW_SIGNED_CODE =
  "eyJwcm9kdWN0IjoiQ3Jpc3AgU3VpdGUiLCJsaWNlbnNlSWQiOiJDUklTUC1ST1RBVElPTi1URVNUIiwidXNlck5hbWUiOiJSb3RhdGlvbiBUZXN0IiwiaXNzdWVkQXQiOiIyMDI2LTA3LTMxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDM2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJmZWF0dXJlcyI6WyJhbGwiXX0.6vruWbKKt62IMUrNCsAO7KX1VnCquCSo--9soGWi6ImiVhEKSMrmkr5ac_3TJlvoq8neVisTvmq28vbsmEjwCQ";
const OLD_SIGNED_CODE =
  "eyJwcm9kdWN0IjoiQ3Jpc3AgU3VpdGUiLCJsaWNlbnNlSWQiOiJDUklTUC1ST1RBVElPTi1URVNUIiwidXNlck5hbWUiOiJSb3RhdGlvbiBUZXN0IiwiaXNzdWVkQXQiOiIyMDI2LTA3LTMxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDM2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJmZWF0dXJlcyI6WyJhbGwiXX0.X-7SDEb1mH9MaBiuWdEqp914BUAG3lPuwo-aB5ZswB7On65wm3UdoYPf8knei7JKd2pWimmsI1FXufb2sPggDw";

describe("license key rotation (dual public keys)", () => {
  beforeAll(() => {
    // Node 测试环境补齐 window，验签使用 Node WebCrypto (Ed25519)
    (globalThis as unknown as { window: unknown }).window = globalThis;
  });

  it("accepts codes signed with the new key", async () => {
    const result = await verifyLicenseCode(NEW_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(true);
  });

  it("accepts legacy codes signed with the old key during transition", async () => {
    const result = await verifyLicenseCode(OLD_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(true);
  });

  it("rejects tampered codes", async () => {
    const tampered = OLD_SIGNED_CODE.slice(0, -1) + "A";
    const result = await verifyLicenseCode(tampered, "crisp-asr");
    expect(result.valid).toBe(false);
  });
});
