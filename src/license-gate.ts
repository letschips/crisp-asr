import { Notice } from "obsidian";
import { verifyLicenseCode } from "./license";

/**
 * The single license gate. It is a module function rather than a plugin method, so replacing
 * a method on the plugin instance from the console cannot reach it; only a code that passes
 * the signature check opens it.
 */
export async function requireAsrLicense(plugin: { settings: { licenseCode: string } }): Promise<boolean> {
  const code = plugin.settings.licenseCode;
  if (!code) {
    new Notice("🔒 Crisp ASR 未激活，请先在设置中输入授权码激活后使用。");
    return false;
  }
  const check = await verifyLicenseCode(code);
  if (check.valid !== true) {
    new Notice(`🔒 Crisp ASR 授权无效: ${check.reason || "未激活"}`);
    return false;
  }
  return true;
}
