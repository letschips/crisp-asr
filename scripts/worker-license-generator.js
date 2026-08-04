// Crisp Suite 5合1通用手机网页发卡器 & 设备在线绑定/解密/解绑 (Cloudflare Worker 专用代码)

// 私钥只从 Cloudflare Secret (env.PRIVATE_KEY_PEM) 注入，源码不保留私钥
const PUBLIC_KEYS = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiz41HIDpD59SH3DjKnovUO+EEhTJXjvmiug/ev9t4ZQ=
-----END PUBLIC KEY-----`,
];


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

// -----------------------------------------------------------------------------
// 管理辅助函数：管理员鉴权、licenseId 解析、KV 台账读写
// -----------------------------------------------------------------------------
function requireAdmin(body, env) {
  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return new Response(JSON.stringify({ error: "服务端未配置管理员密码" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (!body.password || body.password !== adminPassword) {
    return new Response(JSON.stringify({ error: "管理员密码错误" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
  return null;
}

function parseLicenseIdFromCode(licenseCode) {
  const trimmed = (licenseCode || "").trim();
  const parts = trimmed.split(".");
  if (parts.length !== 2) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToUint8Array(parts[0]))
    );
    return typeof payload.licenseId === "string" && payload.licenseId
      ? payload.licenseId
      : null;
  } catch {
    return null;
  }
}

async function readIssuedIndex(env) {
  if (!env.LICENSE_KV) return [];
  const raw = await env.LICENSE_KV.get("issued_index");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function appendIssuedIndex(env, licenseId) {
  if (!env.LICENSE_KV) return;
  const index = await readIssuedIndex(env);
  if (!index.includes(licenseId)) {
    index.push(licenseId);
    await env.LICENSE_KV.put("issued_index", JSON.stringify(index));
  }
}

async function getIssuedRecord(env, licenseId) {
  if (!env.LICENSE_KV) return null;
  const raw = await env.LICENSE_KV.get(`issued:${licenseId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
        const adminPassword = env.ADMIN_PASSWORD;
        if (!adminPassword) {
          return new Response(JSON.stringify({ error: "服务端未配置管理员密码" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (!body.password || body.password !== adminPassword) {
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

        const privateKeyPem = env.PRIVATE_KEY_PEM;
        if (!privateKeyPem) {
          return new Response(JSON.stringify({ error: "服务端未配置签发私钥 (PRIVATE_KEY_PEM)" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
        const privateKey = await importPrivateKey(privateKeyPem);
        const signatureBuffer = await crypto.subtle.sign(
          "Ed25519",
          privateKey,
          new TextEncoder().encode(payloadBase64)
        );

        const signatureBase64 = uint8ArrayToBase64Url(new Uint8Array(signatureBuffer));
        const licenseCode = `${payloadBase64}.${signatureBase64}`;

        // 发卡台账：记录在 KV，供后续吊销与导出
        const record = {
          licenseId: payload.licenseId,
          licenseCode: licenseCode,
          userName: name,
          product: payload.product,
          featureType: featureType,
          days: days,
          maxDevices: maxDevices,
          issuedAt: issueDate.toISOString(),
          expiresAt: expireDate.toISOString(),
          revoked: false,
          revokedAt: null,
          revokeReason: null
        };
        if (env.LICENSE_KV) {
          await env.LICENSE_KV.put(`issued:${payload.licenseId}`, JSON.stringify(record));
          await appendIssuedIndex(env, payload.licenseId);
        }

        return new Response(JSON.stringify({
          success: true,
          licenseId: payload.licenseId,
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
    // 1.5 管理员吊销 / 恢复 / 台账导出 API
    // -------------------------------------------------------------------------
    if (
      request.method === "POST" &&
      (url.pathname === "/api/revoke" || url.pathname === "/api/unrevoke")
    ) {
      try {
        const body = await request.json();
        const adminError = requireAdmin(body, env);
        if (adminError) return adminError;

        const licenseId =
          parseLicenseIdFromCode(body.licenseCode) ||
          (typeof body.licenseId === "string" ? body.licenseId.trim() : "");
        if (!licenseId) {
          return new Response(
            JSON.stringify({ error: "缺少有效的 licenseId 或卡密" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const revoke = url.pathname === "/api/revoke";
        const record = await getIssuedRecord(env, licenseId);

        if (env.LICENSE_KV) {
          if (revoke) {
            const revokedAt = new Date().toISOString();
            const reason = (body.reason || "").trim() || "管理员吊销";
            await env.LICENSE_KV.put(
              `revoked:${licenseId}`,
              JSON.stringify({ revokedAt, reason })
            );
            if (record) {
              record.revoked = true;
              record.revokedAt = revokedAt;
              record.revokeReason = reason;
              await env.LICENSE_KV.put(
                `issued:${licenseId}`,
                JSON.stringify(record)
              );
            }
          } else {
            await env.LICENSE_KV.delete(`revoked:${licenseId}`);
            if (record) {
              record.revoked = false;
              record.revokedAt = null;
              record.revokeReason = null;
              await env.LICENSE_KV.put(
                `issued:${licenseId}`,
                JSON.stringify(record)
              );
            }
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            action: revoke ? "revoke" : "unrevoke",
            licenseId,
            userName: record?.userName || null,
            revoked: revoke,
            message: revoke
              ? "该授权已吊销，相关设备下次联网验证将被拒绝"
              : "已恢复该授权"
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/list-issued") {
      try {
        const body = await request.json();
        const adminError = requireAdmin(body, env);
        if (adminError) return adminError;

        const index = await readIssuedIndex(env);
        const records = [];
        for (const licenseId of index) {
          const record = await getIssuedRecord(env, licenseId);
          if (!record) continue;
          let revoked = !!record.revoked;
          let revokedAt = record.revokedAt || null;
          if (env.LICENSE_KV) {
            const revokedRaw = await env.LICENSE_KV.get(`revoked:${licenseId}`);
            if (revokedRaw) {
              try {
                const r = JSON.parse(revokedRaw);
                revoked = true;
                revokedAt = r.revokedAt || revokedAt;
              } catch {}
            }
          }
          records.push({ ...record, revoked, revokedAt });
        }
        records.sort((a, b) =>
          String(b.issuedAt || "").localeCompare(String(a.issuedAt || ""))
        );

        const wantCsv = new URL(request.url).searchParams.get("format") === "csv";
        if (wantCsv) {
          const header = [
            "licenseId",
            "userName",
            "product",
            "featureType",
            "days",
            "maxDevices",
            "issuedAt",
            "expiresAt",
            "revoked",
            "licenseCode"
          ];
          const lines = [header.join(",")];
          for (const r of records) {
            lines.push(
              [
                r.licenseId,
                r.userName,
                r.product,
                r.featureType,
                r.days,
                r.maxDevices,
                r.issuedAt,
                r.expiresAt,
                r.revoked ? "是" : "否",
                r.licenseCode
              ]
                .map(csvEscape)
                .join(",")
            );
          }
          return new Response(lines.join("\n"), {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="crisp-issued-${new Date().toISOString().split("T")[0]}.csv"`
            }
          });
        }

        return new Response(
          JSON.stringify({ success: true, count: records.length, records }),
          { headers: { "Content-Type": "application/json" } }
        );
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

        // 服务器端 Ed25519 验签（新旧公钥过渡期双校验）
        let isSignatureValid = false;
        for (const pem of PUBLIC_KEYS) {
          const publicKey = await importPublicKey(pem);
          if (await crypto.subtle.verify(
            "Ed25519",
            publicKey,
            base64UrlToUint8Array(signatureBase64),
            new TextEncoder().encode(payloadBase64)
          )) {
            isSignatureValid = true;
            break;
          }
        }

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

        // 吊销检查：被管理员吊销的授权直接拒绝
        if (env.LICENSE_KV) {
          const revokedRaw = await env.LICENSE_KV.get(`revoked:${payload.licenseId}`);
          if (revokedRaw) {
            return new Response(JSON.stringify({
              valid: false,
              reason: "该授权已被吊销，如有疑问请联系卖家"
            }), { status: 403, headers: { "Content-Type": "application/json" } });
          }
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
            <input type="password" id="password" placeholder="输入管理员密码..." value="">
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
                <option value="1">1 天测试版 (24小时)</option>
            </select>
        </div>

        <button class="btn-submit" onclick="generateLicense()">一键签发通用卡密</button>

        <div class="result-box" id="resultBox">
            <div class="result-info" id="resultInfo"></div>
            <textarea id="licenseCodeText" readonly></textarea>
            <button class="btn-copy" onclick="copyCode()">📋 复制卡密发送给买家</button>
        </div>
    </div>

    <div class="card" style="margin-top:16px;">
        <h1 style="font-size:18px;">⚙️ 管理操作</h1>
        <p class="subtitle">吊销违规授权 / 恢复误吊销 / 导出发卡台账</p>

        <div class="form-group">
            <label>管理员密码</label>
            <input type="password" id="adminPassword" placeholder="输入管理员密码..." value="">
        </div>

        <div class="form-group">
            <label>卡密 / licenseId</label>
            <input type="text" id="revokeCode" placeholder="粘贴要处理的卡密或 licenseId">
        </div>

        <div style="display:flex; gap:8px;">
            <button class="btn-submit" style="background:#ff3b30;" onclick="revokeLicense(true)">吊销激活</button>
            <button class="btn-submit" style="background:#34c759;" onclick="revokeLicense(false)">恢复激活</button>
        </div>

        <div style="margin-top:12px;">
            <button class="btn-submit" style="background:#5856d6;" onclick="exportLedger()">导出发卡台账 (CSV)</button>
        </div>

        <div class="result-box" id="adminResultBox">
            <div class="result-info" id="adminResultInfo"></div>
            <textarea id="adminOutput" readonly></textarea>
            <button class="btn-copy" onclick="copyAdminOutput()">📋 复制</button>
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

        async function revokeLicense(revoke) {
            const password = document.getElementById('adminPassword').value;
            const licenseCode = document.getElementById('revokeCode').value.trim();
            if (!password) { alert('请输入管理员密码'); return; }
            if (!licenseCode) { alert('请输入卡密或 licenseId'); return; }
            const res = await fetch(revoke ? '/api/revoke' : '/api/unrevoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, licenseCode })
            });
            const data = await res.json();
            const box = document.getElementById('adminResultBox');
            box.classList.add('active');
            document.getElementById('adminResultInfo').innerText =
                (res.ok && data.success)
                    ? (revoke ? '✅ 已吊销：' : '✅ 已恢复：') + (data.userName || data.licenseId)
                    : '❌ ' + (data.error || '操作失败');
            document.getElementById('adminOutput').value = JSON.stringify(data, null, 2);
        }

        async function exportLedger() {
            const password = document.getElementById('adminPassword').value;
            if (!password) { alert('请输入管理员密码'); return; }
            const res = await fetch('/api/list-issued?format=csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const text = await res.text();
            const box = document.getElementById('adminResultBox');
            box.classList.add('active');
            if (!res.ok) {
                document.getElementById('adminResultInfo').innerText = '❌ 导出失败';
                document.getElementById('adminOutput').value = text;
                return;
            }
            document.getElementById('adminResultInfo').innerText = '✅ 台账已生成，复制或保存为 CSV 文件';
            document.getElementById('adminOutput').value = text;
        }

        function copyCode() {
            const text = document.getElementById('licenseCodeText');
            text.select();
            document.execCommand('copy');
            alert('🎉 卡密已成功复制到剪贴板！');
        }

        function copyAdminOutput() {
            const text = document.getElementById('adminOutput');
            text.select();
            document.execCommand('copy');
            alert('已复制！');
        }
    </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
