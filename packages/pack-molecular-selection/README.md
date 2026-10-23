# Molecular Selection pack

Development fixture package `dsh-revbayes-forge-pack-molecular-selection` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `molecular-selection`
- Tool: `revbayes_generate_molecular`
- Maturity: `golden`

**What it generates.** Builds molecular-evolution scripts for selection: PoMo analyses from count files via `readPoMoCountFile` + `fnReversiblePoMo`, PoMoBalance, and codon-level selection models using `translateCharacters("Codon")` + `fnCodonHKY`. Virtual population size, state counts, and genetic code/phase are validated.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `pomo` | PoMo | `pomo.Rev` |
| `pomobalance` | PoMoBalance | — |
| `codon_selection` | Codon selection | `codon_selection.Rev` |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`molecular-selection`
- 工具：`revbayes_generate_molecular`
- 成熟度：`golden`

**生成内容。** 生成面向选择的分子演化脚本：基于 `readPoMoCountFile` + `fnReversiblePoMo` 的 PoMo 计数文件分析、PoMoBalance，以及使用 `translateCharacters("Codon")` + `fnCodonHKY` 的密码子选择模型。校验虚拟群体大小、状态数与遗传密码/相位。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `pomo` | PoMo | `pomo.Rev` |
| `pomobalance` | PoMoBalance | — |
| `codon_selection` | Codon selection | `codon_selection.Rev` |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
