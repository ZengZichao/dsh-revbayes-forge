# Posterior Predictive Simulation pack

Development fixture package `dsh-revbayes-forge-pack-pps` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `pps`
- Tool: `revbayes_pps`
- Maturity: `golden`

**What it generates.** Builds posterior predictive simulation workflows around a base script (inline text or a workspace path) or a base spec resolved through core generation. Each run produces two artifacts — the main PPS script and a simulation-only script — with `replicates > 0` and `thinning > 0` enforced and the base script's trailing `q()` stripped.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `pps` | PPS (DNA) | `pps.Rev` |
| `pps_morphology` | PPS (morphology) | `pps_morphology.Rev` |
| `posterior_predictive` | Posterior predictive | — |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`pps`
- 工具：`revbayes_pps`
- 成熟度：`golden`

**生成内容。** 围绕 base 脚本（内联文本或工作区路径）或 base spec（经 core 生成解析）构建后验预测模拟工作流。每次生成产出两个 artifact：主 PPS 脚本与仅模拟脚本；强制 `replicates > 0`、`thinning > 0`，并剥离 base 脚本结尾的 `q()`。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `pps` | PPS (DNA) | `pps.Rev` |
| `pps_morphology` | PPS (morphology) | `pps_morphology.Rev` |
| `posterior_predictive` | Posterior predictive | — |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
