# Advanced Morphology pack

Development fixture package `dsh-revbayes-forge-pack-morphology-advanced` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `morphology-advanced`
- Tool: `revbayes_generate_morphology`
- Maturity: `golden`

**What it generates.** Builds advanced morphological scripts: Mkv models with `coding="variable"`, joint ancestral-state reconstruction with `ancestralStateTree` summaries, and stochastic character mapping with `mvCharacterHistory`/`mnStochasticCharacterMap` monitors. The core Mk generation path stays independent and never silently falls back.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `mkv` | Mkv | `mkv.Rev` |
| `ancestral_state` | Ancestral state | `ancestral_state.Rev` |
| `stochastic_map` | Stochastic map | `stochastic_map.Rev` |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`morphology-advanced`
- 工具：`revbayes_generate_morphology`
- 成熟度：`golden`

**生成内容。** 生成进阶形态学脚本：使用 `coding="variable"` 的 Mkv 模型、带 `ancestralStateTree` 汇总的联合祖先状态重建，以及带 `mvCharacterHistory`/`mnStochasticCharacterMap` 监视器的随机性状映射。core 的 Mk 生成路径保持独立，不会静默回退。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `mkv` | Mkv | `mkv.Rev` |
| `ancestral_state` | Ancestral state | `ancestral_state.Rev` |
| `stochastic_map` | Stochastic map | `stochastic_map.Rev` |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
