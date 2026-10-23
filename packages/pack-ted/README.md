# Total Evidence Dating pack

Development fixture package `dsh-revbayes-forge-pack-ted` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `ted`
- Tool: `revbayes_generate_ted`
- Maturity: `verified` (enabled by default)

**What it generates.** Builds total-evidence dating scripts by orchestrating the `fbd` and `dating` packs: it takes an FBD baseline spec or script, adds extant clade ages, optional calibrations, and TED-specific monitors and MCMC settings. If either dependency is disabled, the pack stays blocked and its tool is not registered.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `ted` | TED | `ted.Rev` |
| `ted_range` | TED with ranges | — |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`ted`
- 工具：`revbayes_generate_ted`
- 成熟度：`verified`（默认启用）

**生成内容。** 通过编排 `fbd` 与 `dating` 两个包生成全证据定年（TED）脚本：以 FBD 基线 spec 或脚本为起点，追加现生支系年龄、可选校准，以及 TED 专属的 monitors 与 MCMC 设置。任一依赖未启用时该包保持 blocked，不注册工具。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `ted` | TED | `ted.Rev` |
| `ted_range` | TED with ranges | — |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
