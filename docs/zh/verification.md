# 验证与发布门禁

本仓库通过一组可重复的门禁锁定行为：静态规则、pack 契约、官方教程覆盖、参考语料回归、真实 RevBayes 运行时与 DSH 安装形态。本文列出每条门禁的命令、断言内容与登记例外机制。诊断规则的细节见 [validation-rules](validation-rules.md)。

## 1. 门禁清单

| 门禁 | 命令 | 断言内容 |
| --- | --- | --- |
| 语法检查 | `npm run check` | 对 `packages/` 与 `scripts/` 下所有 JavaScript 模块做 `node --check` 语法检查，任一文件失败即失败 |
| 单元/契约测试 | `npm test` | 运行 `packages/*/test/*.test.js`：core 的 parser/validator/runtime/catalog/generator；core service 的 pack 生命周期、依赖、recipe、block/assembly、分区、legacy 目录、pack 工具写入、状态文件、路由与客户端；每个 pack 的 manifest、spec 校验（含非法 spec）、canonical golden、工具注册/禁用/依赖 blocked；workflow（PPS/model-selection 的 base_script/base_spec、TED recipe + 依赖 blocked） |
| 组合门禁 | `npm run verify` | `check` + `test` + `coverage:check` 全部通过 |
| 覆盖报告 | `npm run coverage` | 输出 18 个分析族 / 304 个教程脚本的归属报告 |
| 覆盖门禁 | `npm run coverage:check` | 覆盖登记完整性（见 §3） |
| 语料回归 | `npm run corpus` | 对 544 个官方教程 `.Rev` 脚本做静态校验；538 个必须 clean，只允许 6 个登记例外（见 §2）；任何新增 error 都是门禁失败 |
| Golden 再生成 | `npm run goldens` | 从各 pack 的 `fixtures/canonical.json` 重新生成 canonical 脚本，与提交的 golden 输出（经日期/空白归一化）比较 |
| 真实运行时 | `npm run test:runtime` | 每个 verified pack 的 canonical 脚本 × dry + smoke 在真实 `rb` 上执行；`REVBAYES_BIN` 必填，否则显式 skip（见 §4） |
| 运行时示例 | `npm run runtime:examples` | core 示例脚本在真实 `rb` 上的 dry + smoke |
| DSH 安装 | `npm run verify:dsh` | 隔离 `DSH_HOME` 安装 core，断言 profile 恰好挂载一个 RevBayes Forge bundle、无 pack bundle 行（详见 [installation](installation.md)） |
| CI | `.github/workflows/verify.yml` | unit + coverage 常开；runtime / DSH 门禁按仓库变量启用 |

## 2. 参考语料与登记例外

`npm run corpus` 静态校验整个官方教程语料。6 个已知非有效脚本作为例外登记在 `scripts/validate-corpus.mjs` 的 `KNOWN_EXCEPTIONS` 中：

```text
tutorials/mcmc_troubleshooting/scripts/inference.Rev
tutorials/mcmc_troubleshooting/scripts/models.Rev
tutorials/mcmc_troubleshooting/scripts/moves.Rev
tutorials/mcmc_troubleshooting/scripts/startingvals.Rev
tutorials/model_selection_bayes_factors/scripts/marginal_likelihood_partition_1.Rev
tutorials/model_selection_bayes_factors/scripts/marginal_likelihood_partition_4.Rev
```

前 4 个是教程散文/代码片段；后 2 个本身缺括号。门禁只允许这 6 个失败——任何新增 error 都意味着校验器规则回归或语料漂移。

## 3. 覆盖登记机制

- `coverage/families.yaml`：18 个分析族，每族声明教程目录、脚本数、owner 包与 maturity；脚本总数必须为 304。
- `coverage/tutorial-index.json`：43 个含 Rev 脚本的官方教程目录与各自脚本数；每个含脚本的目录必须恰好归入一个族，族的脚本数必须与索引一致。
- `coverage/reference-corpus.yaml`：52 个官方教程目录的完整登记表——每个目录要么 `covered`（归入分析族或带 family/note 说明），要么 `excluded` 并写明理由；门禁读取该登记表并与 families.yaml 交叉核对。
- `packages/core/src/data/families.json`：随包分发的运行时镜像，必须与 `coverage/families.yaml` 逐字段一致（供 `reportCoverage()` 读取）。
- 参考教程树可用时（`--root <dir>` 或环境变量 `REVBAYES_TUTORIALS` 指定其位置），`scripts/coverage-report.mjs` 会逐一核对每个目录存在且脚本数与索引一致；树不存在时跳过该步，其余断言照常执行。

完整覆盖说明（官方目录清单、排除理由）见 [coverage](coverage.md)。

## 4. 运行时校验与版本矩阵

- 运行时门禁需要真实 RevBayes 二进制：设置 `REVBAYES_BIN=<path-to-rb>`，或在 profile config 中配置 `revbayesBinary`。
- 未设置 `REVBAYES_BIN` 时 runtime 测试显式 skip，不会伪造成功。
- `npm run test:runtime` 默认只要求 verified pack；`REVBAYES_RUNTIME_ALL=1` 时追加 golden/experimental pack 的可选运行时覆盖（experimental 允许失败，不作为门禁条件）。
- 运行时矩阵以 RevBayes **1.4.1** 为基线：

| 版本 | 平台 | 状态 |
| --- | --- | --- |
| 1.4.1 | Windows x86_64 | 已验证 |
| 1.4.1 | macOS arm64 | 基线 |
| 1.4.1 | Linux x86_64 | CI 目标 |

## 5. 每个 pack 的完成标准

- manifest：id / version / coreApi / maturity / analyses / tools / dependencies；
- spec schema + 语义校验（至少 3 个非法 spec 测试）；
- 至少一条 canonical golden；
- 工具注册/禁用/依赖 blocked 测试；
- `verified`：`runtime.test.mjs` 的 dry + smoke 夹具，且在真实 rb 上通过；
- coverage 条目与脚本文档；
- README 与 fixtures 来源说明；
- 科学正确性由领域审核者确认。

## 6. 发布检查清单

```sh
npm run verify              # check + test + coverage:check
npm run corpus
REVBAYES_BIN=<path-to-rb> npm run test:runtime
npm run verify:dsh
npm pack --dry-run --workspace packages/core
npm pack --dry-run --workspace packages/pack-fbd
npm pack --dry-run --workspace packages/meta-full
```

`verify:dsh` 的 CLI 解析顺序：`DSH_JS`（直接指定 `lib/bin.js`）→ `DSH_BIN` → PATH 中的 `dsh`；设置 `DSH_NPX=1` 时通过 `npx @deepseek-ai/dsh` 运行（版本需满足宿主要求，见 [installation](installation.md)）。无 CLI 且未设置上述变量时输出 SKIP 并退出 0。

## 相关文档

- [installation](installation.md) — `verify:dsh` 安装门禁的行为
- [validation-rules](validation-rules.md) — 语料门禁背后的静态规则
- [coverage](coverage.md) — 覆盖登记表与官方目录清单
