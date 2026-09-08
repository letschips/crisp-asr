# Crisp HTTP 授权修复复核 · 2026-09-08

范围：本地九份授权实现（含未启用 Graph），不是公开产品数量。

## 结论

原交付的八份主力实现 HTTP 分类正确，八份运行文件均与 ANKS、ALL 一致。Graph 遗漏（原覆盖 8/9），其 400、401、403 吊销、403 设备上限四项在独立测试中失败。多数项目未纳入本次错误分类的持续回归测试。

## 本轮补修

- Graph 设置 throw:false，仅 200/400/401/403 采信业务判断；其他状态和网络异常沿用本地验签降级。
- 九个项目补充 HTTP 契约测试并接入原测试入口；Visual 的 check 也运行 test，Focus 的 check 改为调用完整 test。
- 真实 Ed25519 + 临时随机密钥；测试只在隔离 VM 替换公钥，不使用生产密钥，不调用真实授权服务。
- 共 188 项 HTTP/签名测试，覆盖 200、400、401、403、404、408、429、500、502、503、504、HTML/JSON 异常、断网、过期和无效签名。已有 2.5 秒超时的八份实现也测试超时；Graph 保留原来不设显式超时的行为。
- Graph 四个用例先失败，补修后通过；八份已有正确实现保持原代码。
- Graph 仅复制 main.js 到 ALL 已有安装目录，data.json 哈希保持一致，保持未启用；没有给 ANKS 新安装 Graph。
- SOP 更新 HTTP 分类规则，保留已有其他修改。

## 完整自动门禁

| 项目 | 测试数（含本轮） | 结果 |
|---|---:|---|
| crisp-asr | 229 | 通过 |
| crisp-base | 46 | 通过 |
| crisp-graph | 60 | 通过 |
| crisp-reading-rail | 167 | 通过 |
| crisp-recall | 52 | 通过 |
| crisp-visual | 39 | 通过 |
| crisp-annotations | 169 | 通过 |
| crisp-focus | 58 | 通过 |
| crisp-file-explorer | 105 | 通过 |

总计 925 项测试通过。TS 项目还通过构建及其已配置 lint；JS 项目通过语法检查与测试。没有为本次检查推送、打标签或发布。

## 真实运行证据与限制

ANKS 已加载 Annotations 1.6.3、ASR 0.6.2、Base 0.2.6、Focus 1.4.2、Visual 0.2.5、Reading Rail 0.4.7、File Explorer 0.2.67；Recall 当前未加载。

通过 ANKS 的 window.requestUrl 请求本机临时 HTTP fixture 实测：默认 403 抛异常；throw:false 的 403 返回 valid:false；throw:false 的 500 也返回 valid:false。这验证了回归测试模拟的 API 行为。临时服务仅绑定 127.0.0.1，测试后停止。

ANKS dev:errors 返回 No errors captured。ALL eval 返回命令不可用，未宣称验证其加载状态。Graph 未启用，因此本轮未验证其插件运行态。未核验 Cloudflare 线上部署或 GitHub 远端产物。

离线期限、设备 ID、KV 并发一致性与启动预授权仍属于后续架构审核范围，本轮不作已解决声明。
