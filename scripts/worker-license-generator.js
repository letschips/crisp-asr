// Crisp Suite 5合1通用手机网页发卡器 & 设备在线绑定/解密/解绑 (Cloudflare Worker 专用代码)

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIBIv8Bt1oK9PG9yioCjJ+0PxBeekGEKb+wPRyu0qI90l
-----END PRIVATE KEY-----`;

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzih+Socv+iNgjB4OJhlzVQRf9IrlVaLX3ZggFX0H9hc=
-----END PUBLIC KEY-----`;

// 管理员登录密码
const ADMIN_PASSWORD = "crisp2026password"; 

function base64UrlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const raw = atob(padded);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return buffer;
}

function uint8ArrayToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const der = base64UrlToUint8Array(pemContents);
  return await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "Ed25519" },
    true,
    ["sign"]
  );
}

async function importPublicKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = base64UrlToUint8Array(pemContents);
  return await crypto.subtle.importKey(
    "spki",
    der.buffer,
    { name: "Ed25519" },
    true,
    ["verify"]
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // -------------------------------------------------------------------------
    // 1. 管理员签发卡密 API
    // -------------------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/issue") {
      try {
        const body = await request.json();
        if (body.password !== ADMIN_PASSWORD) {
          return new Response(JSON.stringify({ error: "管理员密码错误" }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }

        const name = (body.name || "Valued Customer").trim();
        const days = parseInt(body.days || "365", 10);
        const maxDevices = parseInt(body.maxDevices || "3", 10); // 默认最多激活 3 台设备
        const featureType = body.featureType || "all";
        
        const issueDate = new Date();
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + days);

        const payload = {
          product: "Crisp Suite",
          licenseId: `CRISP-${Date.now().toString(36).toUpperCase()}`,
          userName: name,
          issuedAt: issueDate.toISOString(),
          expiresAt: expireDate.toISOString(),
          maxDevices: maxDevices,
          features: featureType === "all" ? ["all"] : [featureType]
        };

        const payloadJson = JSON.stringify(payload);
        const payloadBase64 = uint8ArrayToBase64Url(new TextEncoder().encode(payloadJson));

        const privateKey = await importPrivateKey(PRIVATE_KEY_PEM);
        const signatureBuffer = await crypto.subtle.sign(
          "Ed25519",
          privateKey,
          new TextEncoder().encode(payloadBase64)
        );

        const signatureBase64 = uint8ArrayToBase64Url(new Uint8Array(signatureBuffer));
        const licenseCode = `${payloadBase64}.${signatureBase64}`;

        return new Response(JSON.stringify({
          success: true,
          userName: name,
          expiresAt: expireDate.toISOString().split("T")[0],
          days: days,
          maxDevices: maxDevices,
          licenseType: featureType === "all" ? "🌟 Crisp 5合1全家桶通用" : `单插件 (${featureType})`,
          licenseCode: licenseCode
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // -------------------------------------------------------------------------
    // 2. Obsidian 插件在线激活 / 解绑 / 校验设备限制 API
    // -------------------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/verify-device") {
      try {
        const { licenseCode, deviceId, action, pluginId } = await request.json();
        
        if (!licenseCode || !deviceId) {
          return new Response(JSON.stringify({ valid: false, reason: "缺少卡密或设备ID" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const parts = licenseCode.trim().split(".");
        if (parts.length !== 2) {
          return new Response(JSON.stringify({ valid: false, reason: "卡密格式无效" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const [payloadBase64, signatureBase64] = parts;
        const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadBase64));
        const payload = JSON.parse(payloadJson);

        // 服务器端 Ed25519 验签
        const publicKey = await importPublicKey(PUBLIC_KEY_PEM);
        const isSignatureValid = await crypto.subtle.verify(
          "Ed25519",
          publicKey,
          base64UrlToUint8Array(signatureBase64),
          new TextEncoder().encode(payloadBase64)
        );

        if (!isSignatureValid) {
          return new Response(JSON.stringify({ valid: false, reason: "授权签名无效或被修改" }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }

        // 到期时间检查
        if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
          return new Response(JSON.stringify({ valid: false, reason: `授权已于 ${payload.expiresAt.split("T")[0]} 到期` }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }

        // 检查 KV 数据库约束（如果用户绑定了 Cloudflare KV）
        const maxDevices = payload.maxDevices || 3;
        const kvKey = `license_devices:${payload.licenseId}`;
        let activeDevices = [];

        if (env.LICENSE_KV) {
          const rawKv = await env.LICENSE_KV.get(kvKey);
          if (rawKv) {
            try { activeDevices = JSON.parse(rawKv); } catch (e) {}
          }

          if (action === "deactivate") {
            activeDevices = activeDevices.filter(id => id !== deviceId);
            await env.LICENSE_KV.put(kvKey, JSON.stringify(activeDevices));
            return new Response(JSON.stringify({
              valid: true,
              deactivated: true,
              count: activeDevices.length,
              maxDevices: maxDevices,
              message: "已成功解绑当前设备"
            }), { headers: { "Content-Type": "application/json" } });
          }

          // 激活逻辑
          if (!activeDevices.includes(deviceId)) {
            if (activeDevices.length >= maxDevices) {
              return new Response(JSON.stringify({
                valid: false,
                reason: `该卡密激活设备数已达上限 (${activeDevices.length}/${maxDevices} 台设备)，无法在第 ${activeDevices.length + 1} 台设备上激活。`
              }), { status: 403, headers: { "Content-Type": "application/json" } });
            }
            activeDevices.push(deviceId);
            await env.LICENSE_KV.put(kvKey, JSON.stringify(activeDevices));
          }
        }

        return new Response(JSON.stringify({
          valid: true,
          payload: payload,
          count: activeDevices.length,
          maxDevices: maxDevices,
          message: env.LICENSE_KV ? `激活成功（设备 ${activeDevices.length}/${maxDevices}）` : "离线验证成功"
        }), { headers: { "Content-Type": "application/json" } });

      } catch (err) {
        return new Response(JSON.stringify({ valid: false, reason: `服务器验证出错: ${err.message}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // -------------------------------------------------------------------------
    // 3. 返回手机端网页 UI
    // -------------------------------------------------------------------------
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Crisp Suite 手机发卡器</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: #f2f2f7; color: #1c1c1e; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
        .card { background: #ffffff; border-radius: 16px; padding: 24px; width: 100%; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; text-align: center; color: #000; }
        p.subtitle { font-size: 13px; color: #8e8e93; text-align: center; margin-bottom: 24px; }
        .form-group { margin-bottom: 16px; }
        label { display: block; font-size: 13px; font-weight: 600; color: #3a3a3c; margin-bottom: 6px; }
        input, select { width: 100%; padding: 12px 14px; font-size: 16px; border: 1px solid #e5e5ea; border-radius: 10px; background: #fafafa; outline: none; transition: border 0.2s; }
        input:focus, select:focus { border-color: #007aff; background: #fff; }
        button.btn-submit { width: 100%; background: #007aff; color: white; border: none; padding: 14px; font-size: 16px; font-weight: 600; border-radius: 12px; cursor: pointer; margin-top: 8px; active: opacity 0.8; }
        .result-box { margin-top: 24px; background: #f9f9fb; border: 1px solid #e5e5ea; border-radius: 12px; padding: 16px; display: none; }
        .result-box.active { display: block; }
        .result-info { font-size: 13px; color: #34c759; font-weight: 600; margin-bottom: 8px; }
        textarea { width: 100%; height: 90px; font-family: monospace; font-size: 12px; padding: 8px; border-radius: 8px; border: 1px solid #d1d1d6; background: #fff; word-break: break-all; resize: none; }
        button.btn-copy { width: 100%; background: #34c759; color: white; border: none; padding: 10px; font-size: 14px; font-weight: 600; border-radius: 8px; margin-top: 10px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🌟 Crisp Suite 发卡器</h1>
        <p class="subtitle">5合1通用离线 Ed25519 移动端发卡工具</p>
        
        <div class="form-group">
            <label>管理员密码</label>
            <input type="password" id="password" placeholder="输入管理员密码..." value="${ADMIN_PASSWORD}">
        </div>

        <div class="form-group">
            <label>买家用户名 / 标志</label>
            <input type="text" id="userName" placeholder="例如：小红书小王">
        </div>

        <div class="form-group">
            <label>授权套餐类型</label>
            <select id="featureType">
                <option value="all">🌟 Crisp 全家桶 (5合1通用通票)</option>
                <option value="crisp-asr">🎙️ Crisp ASR 语音识别单款</option>
                <option value="crisp-annotations">✍️ Crisp Annotations 标注单款</option>
                <option value="crisp-file-explorer">📁 Crisp File Explorer 小球单款</option>
                <option value="crisp-reading-rail">📖 Crisp Reading Rail 小球单款</option>
                <option value="crisp-focus">🎹 Crisp Focus 打字音效白噪音单款</option>
            </select>
        </div>

        <div class="form-group">
            <label>设备限制数量</label>
            <select id="maxDevices">
                <option value="3">限制 3 台设备 (默认)</option>
                <option value="5">限制 5 台设备</option>
                <option value="1">限制 1 台设备</option>
                <option value="999">不限台数 (999台)</option>
            </select>
        </div>

        <div class="form-group">
            <label>有效时长</label>
            <select id="days">
                <option value="365">1 年 (365天)</option>
                <option value="730">2 年 (730天)</option>
                <option value="36500">永久 (100年)</option>
                <option value="30">1 个月试用 (30天)</option>
            </select>
        </div>

        <button class="btn-submit" onclick="generateLicense()">一键签发通用卡密</button>

        <div class="result-box" id="resultBox">
            <div class="result-info" id="resultInfo"></div>
            <textarea id="licenseCodeText" readonly></textarea>
            <button class="btn-copy" onclick="copyCode()">📋 复制卡密发送给买家</button>
        </div>
    </div>

    <script>
        async function generateLicense() {
            const password = document.getElementById('password').value;
            const name = document.getElementById('userName').value.trim();
            const days = document.getElementById('days').value;
            const featureType = document.getElementById('featureType').value;
            const maxDevices = document.getElementById('maxDevices').value;

            if (!password) { alert('请输入管理员密码'); return; }
            if (!name) { alert('请输入买家用户名'); return; }

            const res = await fetch('/api/issue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, name, days, featureType, maxDevices })
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                alert('签发失败: ' + (data.error || '未知错误'));
                return;
            }

            document.getElementById('resultInfo').innerText = '✅ 签发成功！[' + data.licenseType + '] 用户: ' + data.userName + ' (' + data.maxDevices + '台设备)';
            document.getElementById('licenseCodeText').value = data.licenseCode;
            document.getElementById('resultBox').classList.add('active');
        }

        function copyCode() {
            const text = document.getElementById('licenseCodeText');
            text.select();
            document.execCommand('copy');
            alert('🎉 卡密已成功复制到剪贴板！');
        }
    </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
