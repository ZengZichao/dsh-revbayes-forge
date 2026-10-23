# Model Selection pack

Development fixture package `dsh-revbayes-forge-pack-model-selection` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `model-selection`
- Tool: `revbayes_model_selection`
- Maturity: `golden`

**What it generates.** Builds marginal-likelihood scripts that wrap a base script or base spec in a power posterior and attach a stepping-stone (`steppingStoneSampler`) or path-sampling (`pathSampler`) estimator. Steps (`cats >= 2`), burn-in, and sampling frequency are validated; the resulting runs are computationally expensive.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `stepping_stone` | Stepping-stone | `stepping_stone.Rev` |
| `path_sampling` | Path sampling | `path_sampling.Rev` |
| `marginal_likelihood` | Marginal likelihood | — |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`model-selection`
- 工具：`revbayes_model_selection`
- 成熟度：`golden`

**生成内容。** 生成边际似然脚本：把 base 脚本或 base spec 包进 power posterior，并附加 stepping-stone（`steppingStoneSampler`）或 path-sampling（`pathSampler`）估计器。校验步数（`cats >= 2`）、burn-in 与采样频率；生成的计算开销较大。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `stepping_stone` | Stepping-stone | `stepping_stone.Rev` |
| `path_sampling` | Path sampling | `path_sampling.Rev` |
| `marginal_likelihood` | Marginal likelihood | — |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
