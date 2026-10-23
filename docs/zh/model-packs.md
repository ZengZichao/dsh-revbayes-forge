# 模型包参考

13 个模型 pack 内置于 core bundle，依赖 core，不互相 import。所有 pack 共享输入/输出约定：`spec`、`output_path`、`overwrite`；普通 pack 写单文件，workflow pack（pps/ted）写 artifact 目录。每个 pack 一节：id、工具名、maturity、analyses、关键 spec 字段、数据要求、依赖与限制。工具返回结构见 [tool-reference](tool-reference.md)。

## 1. fbd（verified）

工具 `revbayes_generate_fbd`。分析：`fbd`、`fbd_simple`、`fbd_range`。

```json
{
  "analysis": "fbd",
  "name": "fbd_demo",
  "data": { "file": "bears_morphology.nex", "taxa_file": "bears_taxa.tsv", "matrix_file": "bears_morphology.nex", "type": "Standard", "state_count": 2 },
  "substitution": { "model": "Mk", "gamma": { "categories": 4 } },
  "fbd": { "lambda": 1.0, "mu": 0.2, "psi": 0.1, "rho": 1.0, "origin": 45.0 },
  "mcmc": { "generations": 20000, "sample_every": 10 }
}
```

`fbd_range`：`data.file` 是 stratigraphic ranges TSV，`data.fossil_counts_file` 是计数表，`fbd.timeline` 至少两个边界。不变量：fossil taxon 必须在数据/树中；range min/max 合法；rates 非负；`mu < lambda`；固定树不加 topology move。

## 2. dating（verified）

工具 `revbayes_generate_dating`。分析：`strict_clock`、`relaxed_clock`、`relative_constraints`、`sequential`、`timefig_dating`（golden，requires biogeo pack）。

输入：char data、time tree、substitution、clock（`strict` / `relaxed_lognormal` / `relaxed_exponential`）、calibrations、mcmc。`relative_constraints` 需 `constraints.file`；`timefig_dating` 需 `biogeo.range_file`（跨 pack 依赖 biogeo）。不变量：tree 必须 rooted/time；constraint 与 root age 兼容；clock rate > 0。

## 3. coalescent-demography（verified）

工具 `revbayes_generate_coalescent`。分析：`multispecies_coalescent`、`skyline`、`stairwayplot`。

- MSC：`data.file` + `data.species_tree`，`demography.population_size`；
- skyline：alignment + gene tree，`demography.windows`；
- stairwayplot：`sfs` 数组（≥3）、`intervals`、`mutation_rate`、`generation_time`。

不变量：loci/taxa 映射完整；种群大小 > 0；SFS 非负。

## 4. diversification（verified）

工具 `revbayes_generate_diversification`。分析：`birthdeath`、`sse`、`hisse`、`classe`。

`birthdeath` 只需 `data.tree`；SSE 变体需 `data.states_file` 与 `data.num_states`，并检查 `sampling ∈ [0,1]`、`death < birth`。生成 `dnBDP` 或 `dnCDBDP`。

## 5. continuous-traits（verified）

工具 `revbayes_generate_traits`。分析：`bm`、`ou`、`relaxed_bm`、`multivariate`。

输入 continuous matrix、time tree、`model.sigma2/alpha/theta/dimensions/root_states`。不变量：trait index 合法；sigma2/alpha > 0；多变量 dimensions ≥ 2。

## 6. biogeo（golden）

工具 `revbayes_generate_biogeo`。分析：`dec`、`geosse`、`fig`、`multifig`、`timefig`。

输入 range/tree/features、`data.areas`、`model.dispersal/extirpation`；TimeFIG 需 `epochs`。不变量：range 与 area 集合合法；adjacency/epoch 顺序；FIG feature 与 area/epoch 对齐。官方旧版页面（`biogeo_hoehna`、`geosse_orig`、`multifig_orig`、`timefig_orig`）的脚本归入本 pack 的覆盖登记，以校验覆盖为主。

## 7. morphology-advanced（golden）

工具 `revbayes_generate_morphology`。分析：`mkv`、`ancestral_state`、`stochastic_map`。

输入 morphology、tree、state_count、可选 gamma。Mkv 使用 `coding="variable"`；ASR 追加 `mnJointConditionalAncestralState` 与 `ancestralStateTree` 摘要；stochastic map 追加 `mvCharacterHistory` / `mnStochasticCharacterMap`。core 的 Mk 路径保持独立、不回退。

## 8. chromosome（golden）

工具 `revbayes_generate_chromosome`。分析：`chromevol`、`bichrom`、`chromosse`。

输入 counts TSV、tree、`model.max_chromosome/gain/loss/polyploidy`。不变量：counts ≤ max；状态空间与数据一致；rates 非负。

## 9. molecular-selection（golden）

工具 `revbayes_generate_molecular`。分析：`pomo`、`pomobalance`、`codon_selection`。

PoMo 使用 `readPoMoCountFile` + `fnReversiblePoMo`，`type="PoMo"`；codon 使用 `translateCharacters("Codon")`、`fnCodonHKY`，`type="Codon"`。不变量：virtual population size、num states、genetic code/相位。

## 10. host-repertoire（experimental）

工具 `revbayes_generate_host`。分析：`host_repertoire`。

host/parasite trees + association matrix。模型包含 switch rates、`fnHostSwitchRateModifier`、`fnRateGeneratorSequence`、`dnPhyloCTMCDASequence` 与 character-history moves。单脚本、数据依赖强，默认不启用。已知限制：真实 RevBayes 运行时在 character-history proposal 处可能失败；`experimental` 成熟度不要求真实 rb 运行时通过，提升成熟度前需完成领域审核。

## 11. pps（golden，workflow）

工具 `revbayes_pps`。分析：`pps`、`pps_morphology`、`posterior_predictive`。

输入 `base_script`（内联或工作区路径）或 `base_spec`（经 core `generateByPack` 解析）；`replicates > 0`、`thinning > 0`。输出两个 artifact：主 PPS 脚本 + 仅模拟脚本；此时 `output_path` 视为目录。base 脚本结尾的 `q()` 会被剥离；输出目录不得包含 `..`。DNA（`pps`）与 morphology（`pps_morphology`）两条路径均有 canonical golden 用例。

## 12. model-selection（golden，workflow）

工具 `revbayes_model_selection`。分析：`stepping_stone`、`path_sampling`、`marginal_likelihood`。

输入 base_script/base_spec、`cats ≥ 2`、`burnin`、`generations`、`sample_freq`。创建 `powerPosterior`，按方法追加 `steppingStoneSampler` / `pathSampler`。此时 `output_path` 视为目录。stepping-stone / path sampling 计算昂贵，调试时使用极小的 cats/generations 组合。

## 13. ted（verified，workflow）

工具 `revbayes_generate_ted`。分析：`ted`、`ted_range`。

依赖 `fbd` + `dating`（均需已安装并启用）。通过 recipe 检查依赖，通过 core `generateByPack('fbd', ...)` 取基线脚本，再追加 extant clade 年龄、可选 calibration、TED monitors 与 MCMC。缺任一依赖时 `blocked`，不注册工具。

## 14. 成熟度与默认启用

| 成熟度 | Pack |
| --- | --- |
| verified（默认启用） | fbd、dating、coalescent-demography、diversification、continuous-traits、ted |
| golden（需显式启用） | biogeo、morphology-advanced、chromosome、molecular-selection、pps、model-selection |
| experimental（需显式启用） | host-repertoire |

`enabledPacks: all` 全开；`revbayes_environment` 会提示活动工具数量。每个 pack 的 fixtures 为合成小数据；golden 输出经日期/空白归一化后比较。

## 相关文档

- [tool-reference](tool-reference.md) — pack 工具表与输出契约
- [configuration](configuration.md) — `enabledPacks` / `packConfig` 启用策略
- [coverage](coverage.md) — 各 pack 对应的官方教程族
