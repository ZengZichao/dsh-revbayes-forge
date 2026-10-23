# Fossilized Birth-Death pack

Development fixture package `dsh-revbayes-forge-pack-fbd` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `fbd`
- Tool: `revbayes_generate_fbd`
- Maturity: `verified` (enabled by default)

**What it generates.** Builds fossilized birth-death (FBD) scripts from one structured spec: an FBD tree prior over extant and fossil taxa, a Mk/DNA substitution model with optional +I/+G, MCMC moves, and monitors. The `fbd_range` variant reads stratigraphic range tables and fossil counts and enforces a timeline with at least two boundaries. Invariants such as `mu < lambda`, valid fossil taxa, and legal range bounds are checked before any script is written.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `fbd` | fbd | `fbd.Rev` |
| `fbd` | FBD | `fbd.Rev` |
| `fbd_simple` | FBD simple | — |
| `fbd_range` | FBD range | `fbd_range.Rev` |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`fbd`
- 工具：`revbayes_generate_fbd`
- 成熟度：`verified`（默认启用）

**生成内容。** 根据结构化 spec 生成化石 Birth-Death（FBD）脚本：在现生与化石分类单元上构建 FBD 树先验，搭配 Mk/DNA 替换模型（可选 +I/+G）、MCMC moves 与 monitors。`fbd_range` 变体读取地层区间表与化石计数表，并强制至少两个边界的时间线。写入脚本前会校验 `mu < lambda`、化石分类单元合法、区间边界合法等不变量。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `fbd` | fbd | `fbd.Rev` |
| `fbd` | FBD | `fbd.Rev` |
| `fbd_simple` | FBD simple | — |
| `fbd_range` | FBD range | `fbd_range.Rev` |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
