# Host Repertoire pack

Development fixture package `dsh-revbayes-forge-pack-host-repertoire` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `host-repertoire`
- Tool: `revbayes_generate_host`
- Maturity: `experimental`

**What it generates.** Builds host–parasite repertoire scripts from a host tree, a parasite tree, and an association matrix, including host-switch rate modifiers (`fnHostSwitchRateModifier`), data-augmented likelihoods (`dnPhyloCTMCDASequence`), and character-history moves. The model is data-hungry and the pack ships as experimental, disabled by default.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `host-repertoire` | host-repertoire | — |
| `host_repertoire` | Host repertoire | `host_repertoire.Rev` |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`host-repertoire`
- 工具：`revbayes_generate_host`
- 成熟度：`experimental`

**生成内容。** 由寄主树、寄生树与关联矩阵生成 host repertoire 脚本，包含宿主转换速率修饰（`fnHostSwitchRateModifier`）、数据增广似然（`dnPhyloCTMCDASequence`）与性状历史 move。该模型对数据要求高，本包为 experimental，默认不启用。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `host-repertoire` | host-repertoire | — |
| `host_repertoire` | Host repertoire | `host_repertoire.Rev` |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
