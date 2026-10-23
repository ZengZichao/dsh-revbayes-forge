# Coalescent and Demography pack

Development fixture package `dsh-revbayes-forge-pack-coalescent-demography` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `coalescent-demography`
- Tool: `revbayes_generate_coalescent`
- Maturity: `verified` (enabled by default)

**What it generates.** Builds coalescent scripts for the multispecies coalescent (alignment plus guide species tree and population size), coalescent skyline plots with piecewise population windows, and StairwayPlot analyses driven by a site-frequency spectrum array. Locus/species mappings, positive population sizes, and non-negative SFS entries are validated before generation.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `multispecies_coalescent` | Multispecies coalescent | `multispecies_coalescent.Rev` |
| `skyline` | Coalescent skyline | `skyline.Rev` |
| `stairwayplot` | StairwayPlot | `stairwayplot.Rev` |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`coalescent-demography`
- 工具：`revbayes_generate_coalescent`
- 成熟度：`verified`（默认启用）

**生成内容。** 生成溯祖脚本：多物种溯祖（比对数据 + 引导物种树 + 群体大小）、分段群体窗口的 coalescent skyline，以及由位点频谱数组驱动的 StairwayPlot 分析。生成前校验 locus/物种映射完整、群体大小为正、SFS 条目非负。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `multispecies_coalescent` | Multispecies coalescent | `multispecies_coalescent.Rev` |
| `skyline` | Coalescent skyline | `skyline.Rev` |
| `stairwayplot` | StairwayPlot | `stairwayplot.Rev` |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
