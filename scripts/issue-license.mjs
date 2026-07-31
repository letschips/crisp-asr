import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Crisp 5合1全家桶专用 Ed25519 私钥：只从环境变量或本地私密文件读取，不硬编码
function loadPrivateKey() {
  if (process.env.CRISP_PRIVATE_KEY_PEM) return process.env.CRISP_PRIVATE_KEY_PEM;
  const file = process.env.CRISP_PRIVATE_KEY_FILE || join(process.env.HOME || "", ".crisp", "crisp-license-private.pem");
  if (existsSync(file)) return readFileSync(file, "utf8");
  console.error(`缺少私钥：请设置 CRISP_PRIVATE_KEY_PEM 环境变量，或将私钥保存到 ${file}`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    name: 'Valued Customer',
    days: 365,
    features: ['all'] // 'all' 代表 Crisp 全家桶 5 个插件全通
  };

  for (const arg of args) {
    if (arg.startsWith('--name=')) {
      options.name = arg.split('=')[1] || options.name;
    } else if (arg.startsWith('--days=')) {
      options.days = parseInt(arg.split('=')[1], 10) || options.days;
    } else if (arg.startsWith('--features=')) {
      options.features = arg.split('=')[1].split(',') || options.features;
    }
  }
  return options;
}

function issueLicense() {
  const { name, days, features } = parseArgs();

  const issueDate = new Date();
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + days);

  const payload = {
    product: "Crisp Suite",
    licenseId: `CRISP-${Date.now().toString(36).toUpperCase()}`,
    userName: name,
    issuedAt: issueDate.toISOString(),
    expiresAt: expireDate.toISOString(),
    features: features
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(payloadBase64), loadPrivateKey());
  const signatureBase64 = signature.toString('base64url');

  const licenseCode = `${payloadBase64}.${signatureBase64}`;

  console.log("==================================================");
  console.log(" 🎟️ Crisp Suite 5合1通用授权码签发成功！");
  console.log("==================================================");
  console.log(`授权用户: ${name}`);
  console.log(`签发日期: ${issueDate.toLocaleDateString()}`);
  console.log(`到期时间: ${expireDate.toLocaleDateString()} (${days} 天)`);
  console.log(`适用插件: ${features.includes('all') ? '🌟 Crisp 全家桶 5 款插件全部通用' : features.join(', ')}`);
  console.log("--------------------------------------------------");
  console.log("卡密字符串 (直接发给买家):");
  console.log(licenseCode);
  console.log("==================================================\n");
}

issueLicense();
