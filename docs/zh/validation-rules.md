# 校验规则与诊断代码

插件把“校验一个 RevBayes 脚本”组织成静态检查 + 运行时校验的流水线：词法/结构 → 签名/参数 → 语义/文件 → dry/smoke。本文列出各层检查项、严重级别、诊断代码、自动修复范围与 strict 语义。诊断由 `revbayes_validate` 与各 pack 工具返回，`revbayes_lookup` 可用于核对函数签名。

## 1. 校验层次

| 层次 | 入口 | 是否启动 RevBayes | 目的 |
| --- | --- | --- | --- |
| 结构/签名/语义 | `validateScript()` | 否 | 在昂贵运行前发现语法、函数、参数、模型装配问题 |
| dry-run | `runRevBayes({ mode: 'dry' })` | 是 | 真实执行数据读取、模型/树/move/monitor/MCMC 构造 |
| smoke | `runRevBayes({ mode: 'smoke' })` | 是 | 以很小的代数真实采样，验证 move/monitor/运行路径 |

`auto` 先从静态开始；静态有 error、运行时被禁用、或找不到 `rb` 时只返回静态结果。

## 2. 静态检查

### 2.1 词法/结构（RB1xxx）

- 未闭合字符串（RB1002）、非法字符（RB1001）；
- 括号/花括号/方括号不配对；
- 语句之间缺少分隔（RB1101）、无法解析的 token（RB1103/1105）；
- for/while/if 头部不完整（RB1110–1131）；
- 调用参数列表缺逗号/右括号（RB1142/1143）；
- 索引/矩阵下标（RB1140/1141）；
- 函数参数列表/块（RB1104/116x）。

解析器是**宽容**的：遇到一个坏语句会跳到下一个语句边界，继续报告后续问题；不会因为第一行错误吞掉全文。

覆盖的 Rev 语法包括：

- `<-`、`:=`、`~`、`=`、`+=`、`-=`、`*=`、`/=`、`%=`；
- 位置/命名参数，尾逗号，跨行调用；
- `for (i in 1:n) {}`、`while`、`if/else if/else`；
- `function (x) ...` 与 `function RealPos square(Real x) { ... }`；
- 成员/索引、`x[,1]`、`moves[mi++]`；
- `|>` 管道（`Q |> fnGammaASRV(alpha, 4)`）；
- 跨行二元表达式（字符串 `+` 续行）。

### 2.2 名称与函数（RB2xxx）

| 代码 | 默认级别 | 说明 |
| --- | --- | --- |
| RB2101 | warning（strict: error） | 未知 RevBayes 函数；附最近的已知名称和替换修复 |
| RB2102 | error | 常量被当作函数调用 |
| RB2103 | warning | 变量在本脚本中未定义；有 `source()` 时跳过（可能来自被 source 的文件） |

### 2.3 签名与参数（RB3xxx）

| 代码 | 默认级别 | 说明 |
| --- | --- | --- |
| RB3101 | error | 重复命名参数 |
| RB3102 | error（高置信）/ warning | 未知参数名；`generation→generations` 等固定映射为 error，loose/legacy 签名的其他未知名多为 warning |
| RB3103 | error（loose: warning） | 没有匹配的重载/缺参/参数过多 |
| RB3202 | error（loose 且无近邻建议时 warning） | 枚举值非法；附最近合法值 |
| RB3203–RB3210 | error/warning | 数字/布尔/字符串的类型与范围检查（整数、非负、概率 ≤1、TRUE/FALSE 不加引号等） |

签名匹配规则：

1. 先按命名参数填槽，再按位置填剩余槽；
2. 必需参数必须全部填满；
3. 变长签名（`...`）跳过 arity/字面量检查，只检查命名参数是否存在；
4. `readTrees(file, text, ...)` 允许二选一；
5. 普通匹配失败时，尝试“required 参数优先”的位置匹配（应对帮助中可选参数排在 required 参数前的情况）；
6. 别名调用（如 `treeAssembly`）自动按 loose 处理；
7. `LOOSE_SIGNATURE_NAMES` 中的帮助不完整条目只把签名问题降为 warning（strict 下仍为 error）。

### 2.4 语义（RB4xxx）

| 代码 | 级别 | 检查 |
| --- | --- | --- |
| RB4101 | warning | 构造了 `mcmc()` 但没有任何 move |
| RB4102 | warning | 用了 `dnPhyloCTMC` 但没有 `.clamp(data)` |
| RB4103 | info | 声明了 monitors 但没有 append 监视器 |
| RB4104 | info | 构造了 `mcmc()` 但从未 `.run()` |
| RB4105 | warning + review fix | `mcmc(model, moves, monitors)` 位置顺序与帮助签名不同；建议命名参数 |
| RB4106 | error | `mcmc.run(generations=0/负数)` |
| RB4107 | warning | 多个 monitor 写同一个文件 |
| RB4108 | warning | `read*`/`source` 引用的文件不存在（`check_files` 开启且知道 baseDir） |

### 2.5 服务与 pack 生命周期（RB4001–RB4007）

| 代码 | 级别 | 检查 |
| --- | --- | --- |
| RB4001 | error | pack manifest 语法/唯一性/依赖 DAG 非法（`registerPack`） |
| RB4002 | error | `generateByPack` 指定的 pack 未安装 |
| RB4003 | error | pack 已安装但未启用 |
| RB4004 | error | pack 中不存在指定的 analysis |
| RB4005 | error | analysis 的跨 pack `requires` 未安装/未启用 |
| RB4007 | error | recipe 依赖 pack 未启用 |

pack 工具写入错误使用各 pack 前缀 + `58xx`（如 `FBD5802` 拒绝覆盖），诊断 `source` 为 `pack:<id>`。

### 2.6 Pack 诊断命名空间

| Pack | 前缀 | `source` |
| --- | --- | --- |
| fbd | `FBD` | `pack:fbd` |
| dating | `DAT` | `pack:dating` |
| coalescent-demography | `COA` | `pack:coalescent-demography` |
| diversification | `DIV` | `pack:diversification` |
| continuous-traits | `TRA` | `pack:continuous-traits` |
| biogeo | `BIO` | `pack:biogeo` |
| morphology-advanced | `MOR` | `pack:morphology-advanced` |
| chromosome | `CHR` | `pack:chromosome` |
| molecular-selection | `MOL` | `pack:molecular-selection` |
| host-repertoire | `HOS` | `pack:host-repertoire` |
| pps | `PPS` | `pack:pps` |
| model-selection | `SEL` | `pack:model-selection` |
| ted | `TED` | `pack:ted` |

pack 生成结果由 core 再次做 strict 静态校验；pack 不能复用 core 的 RB 代码。

## 3. 生成器诊断（RB5xxx）

| 代码 | 说明 |
| --- | --- |
| RB5000–RB5033 | 规格不是对象、analysis/data/type/state_count 非法、模型参数非法、数组长度/和为 1、树/枝长/先验组合非法、MCMC 参数非法、没有自由参数 |
| RB5101–RB5104 | 非致命警告：固定树忽略 outgroup、nruns>4、sample_every>generations、name 被清洗 |
| RB5800–RB5803 | 工具层：工作区外写入被拒、拒绝覆盖、输出目录在工作区外/创建失败、写文件失败 |

RB5033 是一个重要的正确性检查：固定树 + 固定枝长 + 全固定替换/速率模型会产生一个没有任何 move 的 MCMC，插件直接拒绝，而不是生成一个无法采样的脚本。

## 4. 运行时诊断（RB6xxx）

RevBayes 的错误文本通常没有脚本行号；插件会：

- 用 `buildCallLineIndex()` 把错误中的函数/方法名映射回脚本第一处调用行；
- 解析 `Error:`、`Missing Variable:`、`Provided call`/`Correct usage`、`Potentially matching functions` 块；
- 同一错误只保留一条，避免几十条 `lnProb = inf` 刷屏（最多返回配置的 `maxDiagnostics`）。

| 代码 | 典型消息 | 建议 |
| --- | --- | --- |
| RB6001 | `No overloaded function 'x' matches...` / `No function named 'x'` / `Unknown function 'x'` | 查签名/最近函数名；优先使用 `revbayes_lookup` |
| RB6002 | `Argument or label mismatch for function call` | 按 `Correct usage` 改参数名/顺序/数量 |
| RB6003 | `Missing Variable: Variable x does not exist` | 在之前定义/读取变量，或修拼写 |
| RB6004 | `Could not open...` / `Could not parse ... as a number` | 绝对路径/工作目录；修数据文件 |
| RB6005 | `Index 0 not allowed...` / 索引类型 | RevBayes 下标从 1 开始 |
| RB6006 | `SSE model has 2 states, but observed data set has 4 states` | 状态数与数据匹配（如 `fnJC(4)`） |
| RB6007 | `Cannot complete this assignment ... circular dependency` | 拆开依赖，先定义常量 |
| RB6008 | `Could not compute lnProb ... = inf` | 检查先验支撑集/初值 |
| RB6009 | `Newick error at line/column` | 修树文件 |
| RB6010 | `Warning:` | 保留为 warning，不影响 `ok` |
| RB6996 | 调用方取消 | 空闲后重试 |
| RB6997 | 被信号终止 | 检查内存/崩溃 |
| RB6998 | 超时 | 增大 timeout、减小 smoke 代数、检查挂起 |
| RB6999 | 非零退出但没有可识别消息 | 查看 stdout/stderr 摘要 |

`Problem processing line N in file "..."` 不是独立错误：插件把它作为位置上下文附加到前一条诊断（RevBayes 1.4.1 的真实输出形态），避免重复报错。

运行时 skipped 的原因用 RB5900–RB5905 表达（运行时被禁用、静态错误、找不到二进制、选项非法、run 嵌套在 block/function 中无法安全改写），它们不会被误报成脚本错误。RB5905 情况下不会启动 RevBayes，避免把完整 MCMC 误当成 dry-run 执行。

## 5. 自动修复

`apply_fixes: true` 时只应用 `fix.safety === 'safe'` 的修复：

- 未知函数 → 最近函数名（编辑距离 ≤2）；
- 枚举值 → 最近合法值；
- 未知参数 → 最近参数名（高置信度）；
- `TRUE/FALSE` 被写成字符串 → 去掉引号；
- `generation` → `generations` 等固定映射。

`allow_risky_fixes: true` 才会应用 `safety: 'review'`，例如把 `mcmc(model, moves, monitors)` 改成命名参数。修复按范围从后往前应用，重叠的修复会跳过；修复后重新校验并返回 `fixed_script`。

## 6. strict 语义

默认（`strict: false`）下，**未知函数**和 **loose 签名上的远端未知参数**是 warning，因为：

- RevBayes 帮助目录是快照，可能落后于源码；
- 教程/项目脚本可能使用旧参数名（如 `dnFBDP(origin=..., psi=...)`）。

strict 打开后它们变成 error。高置信度问题（`mcmc.run(generation=...)`、非法枚举、明确的参数数量/必需参数错误）在两种模式下都是 error。

## 7. 已知误报/漏报边界

- 变量未定义检查在脚本含 `source()` 时跳过；不含 source 但依赖交互式会话变量的脚本可能产生 warning。
- 帮助数据缺失的成员方法直接跳过，不报未知方法。
- 固定树的 taxa 数量/名称一致性未做静态比对；需 dry-run 或人工确认。
- 运行时行号是按函数名反查的近似值；RevBayes 自身不输出精确脚本行。
- 执行期只覆盖第一个顶层 run；多阶段脚本只验证第一阶段 setup/smoke。
- 参考语料门禁中登记的 6 个非有效脚本均为教程散文片段或本身缺右括号的脚本（清单见 [verification](verification.md)），不属于校验器规则问题。

## 相关文档

- [tool-reference](tool-reference.md) — `revbayes_validate` 参数与修复开关
- [configuration](configuration.md) — `strict` / `checkFiles` / `maxDiagnostics` 配置
- [verification](verification.md) — 语料门禁如何锁定上述规则
