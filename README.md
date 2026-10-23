# RevBayes Forge (dsh-revbayes-forge)

English: [README.en.md](README.en.md)（与本文互为镜像，结构与事实一致。）

DeepSeek Harness（DSH）的 RevBayes 脚本生成与校验插件（`dsh-revbayes-forge` v0.1.0，GPL-3.0）。它把“写 RevBayes 脚本”变成一条可检查的流水线：结构化分析配置（spec）→ block 装配与脚本生成 → 函数签名与结构静态校验 → dry-run / 短程 smoke → 带修正建议的诊断。**一个插件统管全部 13 个模型包**：core 内部加载所有 pack，DSH 插件列表中只有 RevBayes Forge 一个条目，设置页提供总览、Packs 开关、Environment 检测、Generate 与 Validate 全套界面。

## 特性

- **4 个核心工具**：`revbayes_generate`（生成 + 严格自检）、`revbayes_validate`（静态/运行期校验 + 安全修复）、`revbayes_lookup`（611 个帮助条目 / 654 个签名 / 451 个方法，另含 18 个 legacy 函数与 27 个通用方法）、`revbayes_environment`（rb 路径/版本、配置与 pack 状态）。
- **13 个内置模型包**：默认启用 6 个 `verified` 包，`golden` / `experimental` 在设置页手动开启；共覆盖 18 个分析族，每个包注册自己的生成工具。
- **设置页五个标签页**：总览（core 状态、catalog 规模、活动工具）、Packs（maturity 徽标 + 启用开关）、Environment（RevBayes 检测）、Generate（示例 spec + 预览 + 写入）、Validate（static / dry / smoke）。
- **状态持久化**：pack 启用选择与配置写入 `$DSH_HOME/revbayes-forge/state.json`（temp + rename 原子写），重启后自动恢复；`revbayesBinary` 等运行期配置仍来自 profile 配置。
- **官方教程语料覆盖**：304 个教程脚本（43 个官方目录）全部映射到 18 个分析族；`coverage/reference-corpus.yaml` 登记全部参考目录（covered / excluded + 理由），由 coverage 门禁交叉核对。
- **单 bundle 安装**：只安装 core 一个插件；`packages/pack-*` 是开发夹具包（golden 脚本 / canonical spec / fixtures / runtime 测试），`packages/meta-full` 是开发 meta 包，均不产出 bundle。

## 架构概览

```text
dsh-revbayes-forge  (唯一的 DSH bundle)
  ├─ rev parser / static validator / runtime / catalog
  ├─ blocks + assembly + recipe
  ├─ revbayesForge service (coreApi = 1)
  │    ├─ 13 个内置 pack：src/packs/builtin/*.js
  │    ├─ forge.reconfigure({ enabledPacks, packConfig })  ← 设置页热更新
  │    └─ $DSH_HOME/revbayes-forge/state.json 原子持久化
  ├─ tools: generate / validate / lookup / environment
  ├─ 设置页 HTTP API：/plugins/dsh-revbayes-forge/*
  └─ 设置页 React 入口：lib/client.js（settings.section）

packages/pack-*  开发夹具包（fixtures/golden/runtime tests），不产出 bundle
packages/meta-full  开发 meta 包，不产出 bundle
```

关键边界：

- pack 代码内置于 core，DSH 只安装/挂载 core 一个 bundle；`packages/pack-*` 仅作 golden/夹具/运行时测试的开发包。
- pack 不 import 其他 pack；跨包组合只能通过 core 的 `recipe` / `generateByPack`（TED 即如此）。
- pack 不注册工具、不写文件；core 统一处理启用/禁用、依赖检查、严格校验和 `output_path` 策略。
- `forge.reconfigure()` 按依赖拓扑先启依赖、再启依赖方；依赖不满足的 pack 保持 blocked，不会出现半可用工具。
- 设置页保存后立即注册/注销工具，并把选择写入 `$DSH_HOME/revbayes-forge/state.json`（原子写，重启后仍保留）。

仓库布局：

```text
.
├── packages/
│   ├── core/                      # dsh-revbayes-forge（唯一 bundle）
│   │   ├── src/packs/builtin/     # 13 个内置 pack 模块
│   │   ├── src/host/routes.js     # 设置页 HTTP API
│   │   ├── src/state.js           # $DSH_HOME 状态文件（原子写）
│   │   └── lib/client.js          # 设置页 React 入口
│   ├── pack-fbd/ ... pack-ted/    # 开发夹具包
│   └── meta-full/                 # 开发 meta 包
├── coverage/                      # 18 分析族 / 304 教程脚本归属 + 参考语料登记
├── scripts/                       # 测试 / coverage / corpus / DSH 安装门禁
├── docs/                          # 中英文文档（见“文档”一节）
└── examples/                      # 基础示例
```

## 快速开始

要求：DSH `>= 0.2.1-rc.2`、Node `>= 20`。RevBayes 可选；没有 `rb` 时静态校验仍可用。

```sh
npm install

# 只装 core 一个插件（13 个 pack 全部内置）
dsh plugin --profile desktop add file:"$PWD/packages/core"
```

安装后完全退出并重启 DeepSeek Harness，然后打开设置页（DSH Settings → **RevBayes Forge**）启用所需 pack。验证安装：

```sh
dsh --profile desktop --dump-config | grep -A3 revbayes-forge
```

`scripts/verify-dsh-install.mjs` 使用的就是这条单 bundle 安装路径，并断言 profile dump 中只有 `revbayes-forge` 一行、没有 `dsh-revbayes-forge-pack-*`。

## 工具

核心工具（随插件注册）：

| 工具 | 作用 |
| --- | --- |
| `revbayes_generate` | 生成 DNA/Mk/分区脚本并严格自检；可选写入工作区 |
| `revbayes_validate` | 词法/结构 → 签名/参数 → 语义/文件 → dry/smoke；可安全修复 |
| `revbayes_lookup` | 611 个帮助条目、654 个签名、451 个方法 + 18 个 legacy 函数、27 个通用方法 |
| `revbayes_environment` | `rb` 路径/版本、目录、配置、pack 状态和覆盖提示 |

模型包工具（在设置页启用对应 pack 后注册）：

| Pack id | 工具 | 分析 | Maturity |
| --- | --- | --- | --- |
| `fbd` | `revbayes_generate_fbd` | fbd, fbd_simple, fbd_range | verified |
| `dating` | `revbayes_generate_dating` | strict/relaxed clock, relative constraints, sequential, TimeFIG | verified |
| `coalescent-demography` | `revbayes_generate_coalescent` | multispecies coalescent, skyline, StairwayPlot | verified |
| `diversification` | `revbayes_generate_diversification` | birth-death, SSE, HiSSE, ClaSSE | verified |
| `continuous-traits` | `revbayes_generate_traits` | BM, OU, relaxed BM, multivariate | verified |
| `biogeo` | `revbayes_generate_biogeo` | DEC, GeoSSE, FIG, MultiFIG, TimeFIG | golden |
| `morphology-advanced` | `revbayes_generate_morphology` | Mkv, ancestral state, stochastic map | golden |
| `chromosome` | `revbayes_generate_chromosome` | ChromEvol, BiChroM, ChromoSSE | golden |
| `molecular-selection` | `revbayes_generate_molecular` | codon selection, PoMo, PoMoBalance | golden |
| `host-repertoire` | `revbayes_generate_host` | host repertoire | experimental |
| `pps` | `revbayes_pps` | posterior predictive workflow | golden |
| `model-selection` | `revbayes_model_selection` | stepping-stone, path sampling | golden |
| `ted` | `revbayes_generate_ted` | total-evidence dating orchestrator（依赖 fbd + dating） | verified |

默认策略：`enabledPacks` 缺省（或设置页首次保存前）只启用 `verified`；golden/experimental 在设置页手动开启。PPS / model selection 接受 `base_script`（内联文本或工作区路径）或 `base_spec`（经 core `generateByPack` 解析）；TED 通过 manifest 依赖要求 `fbd` + `dating` 已启用，并组合 FBD 基线脚本。

## 文档

中英文文档互为镜像：`docs/zh/*.md` 与 `docs/en/*.md` 内容一一对应；本 README 与 [README.en.md](README.en.md) 亦互为镜像。

中文文档（docs/zh）：

| 文档 | 内容 |
| --- | --- |
| [docs/zh/installation.md](docs/zh/installation.md) | 安装、要求与单 bundle 安装路径 |
| [docs/zh/configuration.md](docs/zh/configuration.md) | 全部配置字段与启用策略 |
| [docs/zh/architecture.md](docs/zh/architecture.md) | core/pack/recipe/block 契约 |
| [docs/zh/tool-reference.md](docs/zh/tool-reference.md) | 核心工具与 pack 工具 |
| [docs/zh/model-packs.md](docs/zh/model-packs.md) | 逐包 spec/数据/限制 |
| [docs/zh/validation-rules.md](docs/zh/validation-rules.md) | 静态/运行时诊断规则 |
| [docs/zh/settings-ui.md](docs/zh/settings-ui.md) | 设置页、Host HTTP API 与持久化语义 |
| [docs/zh/verification.md](docs/zh/verification.md) | 测试矩阵、coverage 与发布门禁 |
| [docs/zh/coverage.md](docs/zh/coverage.md) | 18 分析族 / 304 脚本归属与参考语料登记 |

## 开发与验证

```sh
npm install
npm run verify        # check + 全部单元/包/工作流测试 + coverage 门禁
npm run corpus        # 544 个参考 .Rev 脚本静态回归（538 clean + 6 个已登记例外）
npm run coverage      # 生成 18 分析族 / 304 脚本归属报告（coverage:check 为门禁）
npm run test:runtime  # verified pack 的真实 RevBayes dry/smoke（需 REVBAYES_BIN）
npm run verify:dsh    # 隔离 DSH_HOME 安装 core，断言 profile 只有一个 bundle 行
```

说明：`npm run test:runtime` 没有 `REVBAYES_BIN`（或在 profile config 设置 `revbayesBinary`）时显式 skip，不会静默通过；设置 `REVBAYES_RUNTIME_ALL=1` 可加跑 golden/experimental 包的可选运行时覆盖。

## 已知限制

1. 真实 RevBayes 运行时测试需要 `REVBAYES_BIN` 或在 profile config 设置 `revbayesBinary`。
2. 生成脚本里的相对数据路径按脚本所在目录解析；把脚本放在数据目录旁或使用绝对路径。
3. TimeFIG/TED 等跨包分析依赖 recipe 与服务状态；缺少依赖时明确 block，不生成半成品。
4. 设置页只管理 pack 选择；`revbayesBinary`/超时/工作区等 config 仍需在 profile 配置中修改后重启。
5. 生成脚本只做静态自检；科学正确性需要领域审核和真实数据验证。

## 许可

GPL-3.0，与 RevBayes / RevScripter 一致。`fixtures/` 中除来源另有说明外均为合成小数据，随仓库以 GPL-3.0 分发；不复制许可不清的教程数据。由 RevBayes 官方帮助派生的 catalog 目录保留上游来源说明。
