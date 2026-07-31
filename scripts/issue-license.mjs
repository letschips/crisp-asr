import crypto from 'node:crypto';

// Crisp 5合1全家桶专用的 Ed25519 私钥
const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIBIv8Bt1oK9PG9yioCjJ+0PxBeekGEKb+wPRyu0qI90l
-----END PRIVATE KEY-----`;

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
  const signature = crypto.sign(null, Buffer.from(payloadBase64), PRIVATE_KEY_PEM);
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
