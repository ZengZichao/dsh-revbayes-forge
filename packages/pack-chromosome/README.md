# Chromosome Evolution pack

Development fixture package `dsh-revbayes-forge-pack-chromosome` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `chromosome`
- Tool: `revbayes_generate_chromosome`
- Maturity: `golden`

**What it generates.** Builds chromosome-number evolution scripts: ChromEvol, BiChroM with a binary trait, and ChromoSSE. Counts tables are bounded by the maximum chromosome number, the state space must match the data, and gain/loss/polyploidy rates are kept non-negative.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `chromevol` | ChromEvol | `chromevol.Rev` |
| `bichrom` | BiChroM | `bichrom.Rev` |
| `chromosse` | ChromoSSE | `chromosse.Rev` |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`chromosome`
- 工具：`revbayes_generate_chromosome`
- 成熟度：`golden`

**生成内容。** 生成染色体数目演化脚本：ChromEvol、带二元性状的 BiChroM，以及 ChromoSSE。校验计数不超过最大染色体数、状态空间与数据一致、增益/丢失/多倍化速率非负。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `chromevol` | ChromEvol | `chromevol.Rev` |
| `bichrom` | BiChroM | `bichrom.Rev` |
| `chromosse` | ChromoSSE | `chromosse.Rev` |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
