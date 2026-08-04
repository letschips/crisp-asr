import { beforeAll, describe, expect, it, vi } from "vitest";

// 在线校验回归测试：
// - 服务端返回非 200 的 valid:false（吊销 / 设备数上限）必须采信
// - 只有网络异常（requestUrl 抛错）才降级为离线本地验签
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: requestUrlMock }));

import { verifyLicenseCode } from "../src/license";

const VALID_SIGNED_CODE =
  "eyJwcm9kdWN0IjoiQ3Jpc3AgU3VpdGUiLCJsaWNlbnNlSWQiOiJDUklTUC1ST1RBVElPTi1URVNUIiwidXNlck5hbWUiOiJSb3RhdGlvbiBUZXN0IiwiaXNzdWVkQXQiOiIyMDI2LTA3LTMxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDM2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJmZWF0dXJlcyI6WyJhbGwiXX0.6vruWbKKt62IMUrNCsAO7KX1VnCquCSo--9soGWi6ImiVhEKSMrmkr5ac_3TJlvoq8neVisTvmq28vbsmEjwCQ";

describe("license online check", () => {
  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
  });

  it("honors server-side revocation rejection on 403", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 403,
      json: { valid: false, reason: "该授权已被吊销，如有疑问请联系卖家" },
    });
    const result = await verifyLicenseCode(VALID_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("吊销");
  });

  it("honors device limit rejection on 403", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 403,
      json: { valid: false, reason: "该卡密激活设备数已达上限" },
    });
    const result = await verifyLicenseCode(VALID_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("上限");
  });

  it("accepts valid licenses when the server responds 200 valid:true", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { valid: true, message: "激活成功" },
    });
    const result = await verifyLicenseCode(VALID_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(true);
  });

  it("falls back to offline-valid only on network errors", async () => {
    requestUrlMock.mockRejectedValueOnce(new Error("network down"));
    const result = await verifyLicenseCode(VALID_SIGNED_CODE, "crisp-asr");
    expect(result.valid).toBe(true);
  });
});
