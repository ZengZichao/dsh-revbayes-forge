# 设置页与 Host HTTP API

RevBayes Forge 的设置页由 `lib/client.js` 提供，注册在 DSH 的 `settings.section` slot（id `revbayes-forge`，order 20），入口为 DSH 设置 → **RevBayes Forge**。宿主半侧通过 `src/host/routes.js` 在 `/plugins/dsh-revbayes-forge/` 下注册 exact 路由，复用与模型工具完全相同的 forge 服务、pack 工具、静态校验和 workspace 写保护。本文是设置页与 HTTP API 的用户参考。

## 1. 五个标签页

### 1.1 总览

core 状态、RevBayes 二进制与版本、catalog 规模（611 entries / 654 signatures / 451 methods，另含 18 个 legacy 函数与 27 个通用方法）、已启用 pack 数、活动工具数、未覆盖分析族。

### 1.2 Packs

全部 13 个 pack 的管理界面：

- maturity 徽标（verified / golden / experimental）与启用开关；
- 每个 pack 的分析列表（含 per-analysis 的 blocked 原因）、工具名、依赖说明（TED → fbd + dating、timefig_dating → biogeo、pps/model-selection 的 `base_spec` 约定）；
- 勾选后点击“保存并应用”：工具立即注册/注销，选择写入状态文件并持久化。

### 1.3 Environment

rb 路径/版本/来源、allowRuntime、超时、smoke 代数、工作区、catalog 路径、状态文件路径；“检测 RevBayes”按钮（可指定候选路径）。此页为只读展示：`revbayesBinary`、超时等插件 config 仍需在 profile 的 `cordis.patch.yml` 中修改后重启，页面会明确提示这一点。

### 1.4 Generate

选择 pack 与 analysis，粘贴或一键填入示例 JSON spec；脚本预览、诊断、警告；可选写入工作区。输出路径走与模型工具相同的 workspace 写保护与覆盖策略。

### 1.5 Validate

输入脚本文本或工作区路径，选择 `static` / `dry` / `smoke` 模式，可开启严格模式与安全修复；展示静态/运行期结果与诊断。dry/smoke 需要真实 RevBayes 二进制（见 [configuration](configuration.md) 的 `revbayesBinary`）。

## 2. Host HTTP API

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/plugins/dsh-revbayes-forge/state` | GET | 总览数据：core/环境/catalog/packs/counts/tools/state |
| `/plugins/dsh-revbayes-forge/packs` | POST | `{ enabledPacks, packConfig }` → `forge.reconfigure` 热更新 + 持久化，返回新状态与 blocked 列表 |
| `/plugins/dsh-revbayes-forge/generate` | POST | `{ pack, analysis, spec, outputPath?, overwrite? }` → 复用 pack 工具生成 + 严格校验 + 可选写入 |
| `/plugins/dsh-revbayes-forge/validate` | POST | `{ script?/path?, mode, applyFixes?, strict? }` → 复用 `revbayes_validate` |
| `/plugins/dsh-revbayes-forge/tool-schema` | GET | 当前核心 + 已启用 pack 工具 schema |
| `/plugins/dsh-revbayes-forge/detect` | POST | 按给定路径/配置探测 RevBayes |

## 3. 持久化语义

- 状态文件：`$DSH_HOME/revbayes-forge/state.json`（`stateFile` 配置可覆盖；`DSH_HOME` 未设置时默认 `~/.dsh`）。
- 写入方式：临时文件 + `rename` 原子替换；损坏/非法的文件会被忽略并记录日志警告，不会导致插件启动失败。
- 内容：`{ version: 1, enabledPacks: [...], packConfig: {...}, updatedAt }`。
- “保存并应用”后 pack 工具同进程立即注册/注销；重启 DSH 后读取同一状态文件，无需重新配置。
- 不修改 profile 的 `cordis.patch.yml`；rb 路径、超时等 config 仍来自 profile 配置。

## 4. 安全约定

- 请求体上限 2 MB（超限返回 `RB4130`；非法 JSON / 非 JSON 对象返回 `RB4131`）；
- 输出路径统一走 `assertWriteAllowed` workspace 保护，默认拒绝写工作区外、拒绝覆盖已有文件；
- 不执行 shell：dry/smoke 仅 spawn 配置的 RevBayes 二进制；
- 不绕过静态校验；生成结果与工具路径共用同一套严格校验；
- 错误统一 `{ ok: false, error: { code, message, path? } }`；内部异常只记日志，不外泄堆栈。

## 相关文档

- [installation](installation.md) — 状态文件位置与重启行为
- [configuration](configuration.md) — profile 配置键与状态文件的合并关系
- [tool-reference](tool-reference.md) — 路由复用的工具语义
