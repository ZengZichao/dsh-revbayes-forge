# Diversification and SSE pack

Development fixture package `dsh-revbayes-forge-pack-diversification` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `diversification`
- Tool: `revbayes_generate_diversification`
- Maturity: `verified` (enabled by default)

**What it generates.** Builds diversification scripts: birth-death processes on reconstructed trees (`dnBDP`/`dnCDBDP`), state-dependent speciation and extinction (SSE), and the hidden-state HiSSE and ClaSSE variants. Inputs are a tree alone or a tree plus character-state data, with sampling fractions in [0, 1] and `death < birth` checked before generation.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `birthdeath` | Birth-death | `birthdeath.Rev` |
| `sse` | BiSSE/SSE | `sse.Rev` |
| `hisse` | HiSSE | — |
| `classe` | ClaSSE | — |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`diversification`
- 工具：`revbayes_generate_diversification`
- 成熟度：`verified`（默认启用）

**生成内容。** 生成多样化分析脚本：重建树上的 birth-death 过程（`dnBDP`/`dnCDBDP`）、状态依赖物种形成-灭绝（SSE），以及隐状态的 HiSSE 与 ClaSSE 变体。输入可以是单棵树，或树加性状状态数据；生成前检查 sampling ∈ [0, 1] 且 `death < birth`。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `birthdeath` | Birth-death | `birthdeath.Rev` |
| `sse` | BiSSE/SSE | `sse.Rev` |
| `hisse` | HiSSE | — |
| `classe` | ClaSSE | — |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
