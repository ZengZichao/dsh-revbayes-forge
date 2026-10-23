# 工具参考

核心工具由 `dsh-revbayes-forge` 注册；pack 工具在 pack 启用后由 core 统一注册。所有工具接受结构化 JSON，返回 canonical value，并由 `output.render` 生成 Markdown。写文件一律经过 workspace 写保护（见 §4）。

## 1. 核心工具

### 1.1 `revbayes_generate`

从结构化 spec 生成 DNA / Mk / 分区 RevBayes 脚本，生成后做严格静态自检。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `spec` | 是 | `analysis`（`dna` / `morphology` / `partition`，分区 spec 可省略 `analysis`）、`data`、`substitution`、`tree`、`mcmc` |
| `output_path` | 否 | 写入路径，相对会话工作区 |
| `overwrite` | 否 | 默认 `false`，已存在文件拒绝覆盖 |

core 生成能力：

- DNA：JC、F81、K80、HKY、GTR；+I/+G 位点速率变异；
- 形态学：Mk/JC，任意观测状态数；
- 分区：`data.partitions[] = { name, file, type, state_count?, taxa? }` 配合 `substitution.per_partition[name]`；此时 `data.file` 可省略。core 校验分区名/文件/状态数/taxa 一致性，并生成每分区 CTMC 与 monitor；
- 树：均匀拓扑或固定树；枝长固定/估计；exponential/gamma/lognormal/uniform 先验；
- MCMC：多链、move schedule、采样/屏幕频率、调优间隔、输出目录。

### 1.2 `revbayes_validate`

| 字段 | 说明 |
| --- | --- |
| `script` 或 `path` | 二选一：内联脚本文本或工作区路径 |
| `mode` | `auto` / `static` / `dry` / `smoke`（默认取配置 `defaultMode`） |
| `strict` | 覆盖配置中的 `strict` |
| `apply_fixes` / `allow_risky_fixes` | 应用安全 / 需人工确认的修复 |
| `binary` / `workdir` / `timeout_ms` / `max_generations` | 运行时覆盖 |

### 1.3 `revbayes_lookup`

按名称/别名/描述/方法检索签名目录（611 entries / 654 signatures / 451 methods，另含 18 个 legacy 函数与 27 个通用方法）；返回 usage、参数、默认值、枚举、示例；legacy 条目带 `legacy: true`。

### 1.4 `revbayes_environment`

报告 `rb` 二进制与版本、catalog 规模、生效配置、installed/enabled/blocked packs、活动工具、configured-but-not-installed pack 与未覆盖分析族。

## 2. Pack 工具（13 个）

| 工具 | Pack | 主要输入 |
| --- | --- | --- |
| `revbayes_generate_fbd` | fbd | data（matrix/taxa/fossils/counts）、substitution、fbd、mcmc |
| `revbayes_generate_dating` | dating | data、tree、substitution、clock、calibrations/constraints、mcmc |
| `revbayes_generate_coalescent` | coalescent-demography | data/tree 或 sfs、demography、mcmc |
| `revbayes_generate_diversification` | diversification | tree、states、model、mcmc |
| `revbayes_generate_traits` | continuous-traits | continuous data、tree、model、mcmc |
| `revbayes_generate_biogeo` | biogeo | range/tree/features、epochs、model、mcmc |
| `revbayes_generate_morphology` | morphology-advanced | morphology、tree、state_count、mcmc |
| `revbayes_generate_chromosome` | chromosome | counts、tree、max_chromosome、mcmc |
| `revbayes_generate_molecular` | molecular-selection | codon/PoMo data、tree、model、mcmc |
| `revbayes_generate_host` | host-repertoire | host/parasite trees、association matrix、model、mcmc |
| `revbayes_pps` | pps | `base_script` 或 `base_spec`、replicates、thinning、output_dir |
| `revbayes_model_selection` | model-selection | `base_script` 或 `base_spec`、cats/burnin/generations、output_dir |
| `revbayes_generate_ted` | ted | `base_spec`（FBD）、extant_taxa、calibrations、mcmc |

所有 pack 工具统一接受 `spec`、`output_path`、`overwrite`。各 pack 的 spec 字段细节见 [model-packs](model-packs.md)。

## 3. 输出契约

```js
{
  ok: true,
  primary_script: '...',
  artifacts: [{ role: 'main', name: 'analysis.Rev', script: '...' }],
  diagnostics: [],
  warnings: [],
  summary: { error: 0, warning: 0, info: 0 },
  sections: [],
  stats: { lines, bytes, moves, monitors },
  written: true,
  paths: ['...']
}
```

- 普通 pack：单 artifact，`output_path` 为文件；
- workflow pack（pps/ted）：多 artifact，`output_path` 为目录，文件名取 artifact `name` 并做 basename 防逃逸；
- core 对每个 artifact 做严格静态校验，并统一执行工作区/覆盖策略；
- pps / model-selection 接受 `base_script`（内联文本或工作区路径）或 `base_spec`（经 core `generateByPack` 解析）；TED 通过 manifest 依赖要求 `fbd` + `dating` 已启用，并组合 FBD 基线脚本。

## 4. output_path 写保护

- 相对路径基于调用会话的工作区解析；
- 默认拒绝写工作区外路径：core 报 `RB58xx`，pack 报各自前缀 + `58xx`（如 `FBD5802`）；可用配置 `allowWriteOutsideWorkspace: true` 放开；
- 已存在文件默认拒绝覆盖（`RB58xx` / pack 前缀 58xx），传 `overwrite=true` 才覆盖；
- 插件不删除用户已有文件；workflow pack 只在指定目录内创建自己的 artifact 文件。

## 5. 启用与可见性

- pack 未安装：工具不存在；
- 安装但 disabled / blocked：工具不存在，`revbayes_environment` 给出原因；
- 缺依赖：`blocked`，不注册半可用工具；
- `base_spec` 指向未启用的基础 pack：返回明确的 workflow 错误，不回退到 DNA 模板。

## 相关文档

- [model-packs](model-packs.md) — 逐包 spec/数据/依赖/限制
- [validation-rules](validation-rules.md) — 诊断代码与自动修复
- [configuration](configuration.md) — `enabledPacks` 与写入保护配置
