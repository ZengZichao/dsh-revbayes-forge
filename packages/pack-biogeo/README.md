# Biogeography pack

Development fixture package `dsh-revbayes-forge-pack-biogeo` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `biogeo`
- Tool: `revbayes_generate_biogeo`
- Maturity: `golden`

**What it generates.** Builds biogeographic scripts: DEC range evolution, GeoSSE, feature-informed geographic state-dependent speciation-extinction (FIG / MultiFIG), and epoch-structured TimeFIG. Range, area, adjacency, and epoch inputs are aligned and validated before generation; TimeFIG additionally requires an epoch list.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `dec` | DEC | `dec.Rev` |
| `geosse` | GeoSSE | `geosse.Rev` |
| `fig` | FIG | `fig.Rev` |
| `multifig` | MultiFIG | — |
| `timefig` | TimeFIG | — |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`biogeo`
- 工具：`revbayes_generate_biogeo`
- 成熟度：`golden`

**生成内容。** 生成生物地理学脚本：DEC 分布区演化、GeoSSE、feature-informed 地理状态依赖物种形成-灭绝（FIG / MultiFIG），以及带 epoch 结构的 TimeFIG。生成前对分布区、区域、邻接与 epoch 输入做对齐与校验；TimeFIG 还要求提供 epoch 列表。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `dec` | DEC | `dec.Rev` |
| `geosse` | GeoSSE | `geosse.Rev` |
| `fig` | FIG | `fig.Rev` |
| `multifig` | MultiFIG | — |
| `timefig` | TimeFIG | — |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
