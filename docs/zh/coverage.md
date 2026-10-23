# 覆盖说明

本文说明插件的生成/校验能力如何对齐 RevBayes 官方文档：官方教程语料的覆盖登记、18 个分析族的归属、被排除目录的理由，以及覆盖门禁如何强制这些登记。分族的 spec 细节见 [model-packs](model-packs.md)，门禁命令见 [verification](verification.md)。

## 1. 覆盖基准

覆盖以 **revbayes.github.io 官方站点**为准：

- 官方 `tutorials/` 共 **52** 个主题目录（`coverage/reference-corpus.yaml` 登记）；
- 其中 **43** 个目录含 Rev 脚本，共 **304** 个脚本；
- 304 个脚本全部归入 **18** 个分析族（`coverage/families.yaml`）；
- 官方站点 workshops 区块是同一批教程的课程编排，不产生独立目录，不单独登记。

## 2. 18 个分析族

| 族 id | 教程目录 | 脚本数 | Owner | Maturity |
| --- | --- | --- | --- | --- |
| `standard_dna` | ctmc | 5 | core | verified |
| `morphology_tree` | morph_tree | 12 | core, pack-morphology-advanced | mixed |
| `morphology_asr` | morph_ase, morph | 15 | pack-morphology-advanced | golden |
| `partition` | partition | 6 | core | verified |
| `dating_clock` | dating, clocks, relative_time_constraints, sequential_bayes, timefig_dating | 43 | pack-dating-clock | mixed |
| `coalescent` | coalescent, species_tree | 44 | pack-coalescent-demography | verified |
| `fbd_ted` | fbd, fbd_simple, fbd_range, ted_workflow | 43 | pack-fbd, pack-ted | verified |
| `diversification` | divrate, sse | 22 | pack-diversification | verified |
| `continuous_traits` | cont_traits | 24 | pack-continuous-traits | verified |
| `biogeo` | biogeo, biogeo_hoehna, geosse, geosse_orig, multifig, multifig_orig, timefig_simple, timefig_orig | 12 | pack-biogeo | golden |
| `chromosome` | chromo | 6 | pack-chromosome | golden |
| `selection_codon` | selection | 3 | pack-molecular-selection | golden |
| `pomo` | pomos, pomobalance | 2 | pack-molecular-selection | golden |
| `host_repertoire` | host_rep | 1 | pack-host-repertoire | experimental |
| `stairwayplot` | stairwayplot | 5 | pack-coalescent-demography | verified |
| `pps` | model_testing_pps, model_testing_ppred_inf, pps_morpho, intro_posterior_prediction | 36 | pack-pps | golden |
| `model_selection` | model_selection_bayes_factors | 9 | pack-model-selection | golden |
| `basics` | mcmc, intro, mcmc_troubleshooting, docker, tutorial_structure | 16 | core | validation |

合计 18 族 / 304 脚本。owner 中的 `pack-*` 为开发夹具包名，对应内置 pack（见 [architecture](architecture.md)）。

特殊条目：`fig_intro` 归入 `biogeo` 族——该页面本身不含 Rev 代码块，FIG 模型工作流由 biogeo pack 的 `fig` 分析覆盖。

## 3. 排除目录（8 个）

以下目录登记在 `coverage/reference-corpus.yaml` 中为 `excluded`，理由逐条如下：

| 目录 | 理由 |
| --- | --- |
| `concatenation` | 旧重定向页（RB_GeneConcatenation_Tutorial），已被官方站点去索引；不含 Rev 代码块 |
| `convergence` | 外部 R 包 Convenience 的使用指南页；不含 Rev 代码块，无可生成内容 |
| `dice` | CTMC 机制的手工模拟讲解页；不含 Rev 代码块 |
| `quick_tips` | 纯文字技巧页；不含 Rev 代码块，官方教程索引亦未收录 |
| `mcmc_old` | `mcmc_troubleshooting` 的旧版重复页；已被官方站点去索引 |
| `multispecies_coalescent` | 旧重定向页（RB_MultispeciesCoalescent_Tutorial）；主题已由收录的 `species_tree` 与 `coalescent` 教程覆盖 |
| `revscripter` | RevScripter GUI 应用的使用指南；超出脚本生成插件的范围 |
| `tikz` | 未完成的 LaTeX/TikZ 绘图教程；不含 Rev 代码块 |

除这 8 个目录外，其余 44 个目录均为 `covered`；其中 43 个含 Rev 脚本并归入分析族，`fig_intro` 由 biogeo pack 覆盖（见 §2）。

## 4. 帮助目录（API 覆盖）

`revbayes_lookup` 使用的签名目录派生自官方 RevBayes help 数据库（`npm run build:catalog` 构建，随包分发；`catalogPath` 可指向外部更新）。目录规模：**611** 个条目 / **654** 个签名 / **451** 个方法，另含 **18** 个 legacy 函数与 **27** 个通用方法。帮助目录是官方站点的快照，因此 strict 默认只把“未知函数/远端未知参数”降为 warning（见 [validation-rules](validation-rules.md) §6）。

## 5. 门禁如何强制

`scripts/coverage-report.mjs`（`npm run coverage:check`）强制上述登记：

1. 读取 `coverage/families.yaml`：18 族、每族必须声明教程目录、脚本数与 owner；族总数与脚本总数（304）必须匹配；
2. 读取 `coverage/tutorial-index.json`：每个含脚本的教程目录必须恰好归入一个族，族的脚本数必须与索引一致，索引总数必须为 304；
3. 比较运行时镜像 `packages/core/src/data/families.json`：族数、scripts、maturity、owners、tutorials 逐字段必须与 `coverage/families.yaml` 一致（防止随包镜像漂移）；
4. 校验 `coverage/reference-corpus.yaml`：登记表条目数必须等于声明的 `tutorial_directories`（52）；每个官方目录要么 `covered`（归入族或带 family/note），要么 `excluded` 且带 `reason`；families.yaml 中的教程必须已登记；
5. 参考教程树可用时（`--root <dir>` 或环境变量 `REVBAYES_TUTORIALS` 指定其位置），逐一核对：索引中的目录在参考树中存在、每个目录的脚本数与索引一致、参考树中不存在未登记的目录、登记表列出的目录确实存在。

上述任一断言失败即门禁失败，`npm run verify` 因此会拒绝覆盖缺口进入主干。

## 相关文档

- [verification](verification.md) — 门禁命令与语料例外清单
- [model-packs](model-packs.md) — 各分析族对应的 pack 与 spec
- [architecture](architecture.md) — `reportCoverage()` 与双镜像机制
