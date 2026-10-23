# Continuous Traits pack

Development fixture package `dsh-revbayes-forge-pack-continuous-traits` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `continuous-traits`
- Tool: `revbayes_generate_traits`
- Maturity: `verified` (enabled by default)

**What it generates.** Builds scripts for continuous trait evolution on time trees: Brownian motion, Ornstein-Uhlenbeck with optimum and attraction, relaxed Brownian motion with branch-rate variation, and multivariate BM with a covariance dimension. Trait indices, positive `sigma2`/`alpha` values, and `dimensions >= 2` for the multivariate model are validated.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `bm` | Brownian motion | `bm.Rev` |
| `ou` | Ornstein-Uhlenbeck | `ou.Rev` |
| `relaxed_bm` | Relaxed BM | — |
| `multivariate` | Multivariate BM | `multivariate.Rev` |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`continuous-traits`
- 工具：`revbayes_generate_traits`
- 成熟度：`verified`（默认启用）

**生成内容。** 在时间树上生成连续性状演化脚本：Brownian motion、带最适值与吸引系数的 Ornstein-Uhlenbeck、枝率变化的 relaxed Brownian motion，以及带协方差维度的多变量 BM。校验性状索引合法、`sigma2`/`alpha` 为正、多变量时 `dimensions >= 2`。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `bm` | Brownian motion | `bm.Rev` |
| `ou` | Ornstein-Uhlenbeck | `ou.Rev` |
| `relaxed_bm` | Relaxed BM | — |
| `multivariate` | Multivariate BM | `multivariate.Rev` |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
