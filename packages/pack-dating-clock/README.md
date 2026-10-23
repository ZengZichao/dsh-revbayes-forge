# Dating and Clocks pack

Development fixture package `dsh-revbayes-forge-pack-dating-clock` of the RevBayes Forge plugin (`dsh-revbayes-forge`).

## English

- Pack id: `dating`
- Tool: `revbayes_generate_dating`
- Maturity: `verified` (enabled by default)

**What it generates.** Builds divergence-time scripts: strict or relaxed (lognormal/exponential) clocks over a rooted time tree, relative age constraints from a constraints file, sequential Bayesian dating, and TimeFIG dating that combines clock models with feature-informed groups (requires the `biogeo` pack). Calibrations map to node densities, and invariant checks enforce a rooted time tree, constraint/root-age compatibility, and positive clock rates.

**Analyses.**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `strict_clock` | Strict clock | `strict_clock.Rev` |
| `relaxed_clock` | Relaxed clock | `relaxed_clock.Rev` |
| `relative_constraints` | Relative constraints | `relative_constraints.Rev` |
| `sequential` | Sequential Bayesian | — |
| `timefig_dating` | TimeFIG dating | — |

Full spec fields, data requirements, and limitations: [docs/en/model-packs.md](../../docs/en/model-packs.md).

**Fixtures.** Files under `fixtures/` are synthetic small datasets shipped with the repository; they back the golden scripts, canonical specs, and runtime checks used by `npm test` and `npm run test:runtime`.

**Enablement.** Enable this pack in the settings page (RevBayes Forge → Packs); no separate installation is needed.

---

## 中文

- Pack id：`dating`
- 工具：`revbayes_generate_dating`
- 成熟度：`verified`（默认启用）

**生成内容。** 生成分歧时间脚本：在有根时间树上构建 strict 或 relaxed（lognormal/exponential）分子钟、来自约束文件的相对年龄约束、sequential Bayesian 定年，以及将分子钟模型与 feature-informed 类群结合的 TimeFIG 定年（依赖 `biogeo` 包）。校准映射为节点密度；不变量检查保证树已定根、约束与根年龄兼容、分子钟速率大于 0。

**分析列表。**

| Analysis | Title | Canonical golden |
| --- | --- | --- |
| `strict_clock` | Strict clock | `strict_clock.Rev` |
| `relaxed_clock` | Relaxed clock | `relaxed_clock.Rev` |
| `relative_constraints` | Relative constraints | `relative_constraints.Rev` |
| `sequential` | Sequential Bayesian | — |
| `timefig_dating` | TimeFIG dating | — |

完整 spec 字段、数据要求与限制：[docs/zh/model-packs.md](../../docs/zh/model-packs.md)。

**夹具数据。** `fixtures/` 下的文件均为随仓库分发的合成小数据，支撑 golden 脚本、canonical spec 与运行时检查，供 `npm test` 与 `npm run test:runtime` 使用。

**启用方式。** 在设置页（RevBayes Forge → Packs）勾选启用即可，无需单独安装。
