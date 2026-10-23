# 架构

dsh-revbayes-forge 是一个 DSH bundle：rev 解析/校验/运行时/目录、block 装配、服务层、4 个核心工具、设置页 HTTP API 与 React 客户端，以及全部 13 个模型 pack 都在 core 内部。本文描述分层结构、pack 生命周期、服务契约与跨包组合规则；工具接口见 [tool-reference](tool-reference.md)，诊断代码见 [validation-rules](validation-rules.md)。

## 1. 分层

```text
DSH host
  ctx.tools / ctx.provide / ctx.effect
        │
core: dsh-revbayes-forge（唯一的 DSH bundle）
  ├─ rev: parser / static validator / runtime / catalog
  ├─ blocks + assembly + recipe
  ├─ revbayesForge service (coreApi = 1)
  │    ├─ 13 个内置 pack：src/packs/builtin/*.js
  │    ├─ forge.reconfigure({ enabledPacks, packConfig })  ← 设置页热更新
  │    └─ $DSH_HOME/revbayes-forge/state.json 原子持久化
  ├─ tools: generate / validate / lookup / environment
  ├─ 设置页 HTTP API：/plugins/dsh-revbayes-forge/*（src/host/routes.js）
  └─ 设置页 React 入口：lib/client.js（settings.section）

packages/pack-*   开发夹具包（fixtures/golden/runtime tests），不再产出 bundle
packages/meta-full  开发 meta 包（精确锁定版本），不再产出 bundle
```

关键边界：

- pack 代码内置于 core，DSH 只安装/挂载 core 一个 bundle；`packages/pack-*` 仅作为 golden/夹具/运行时测试的开发包。
- pack 不 import 其他 pack；跨包组合只能通过 core 的 `recipe` / `generateByPack`（TED 即如此）。
- pack 不注册工具、不写文件；core 统一处理启用/禁用、依赖检查、严格校验和 `output_path` 策略。
- `forge.reconfigure()` 按依赖拓扑先启依赖、再启依赖方；依赖不满足的 pack 保持 `blocked`，不会出现半可用工具。
- 设置页保存后立即注册/注销工具，并把选择写入 `$DSH_HOME/revbayes-forge/state.json`（原子写，重启后仍保留）。

## 2. 包生命周期

1. DSH 加载 core，调用 `apply(ctx, config)`；
2. core 规范化配置（并与状态文件中的 pack 选择合并）、加载签名目录、创建 `revbayesForge`、`ctx.provide('revbayesForge', forge)`，注册 4 个核心工具；
3. DSH 加载每个内置 pack，pack `apply` 只做三件事：
   - `forge.registerPack(manifest, ctx)`（始终登记 installed manifest）；
   - 若 `forge.isPackEnabled(id, maturity)`：`registration.enable()`；
   - `ctx.effect(...)` 注册 disposer，卸载时 `disable()` / `dispose()`。

   pack 入口必须 `inject = ['tools', 'revbayesForge']`（`enable()` 通过 `ctx.tools` 注册工具），入口 `name` 必须等于自己的 Cordis entry id，且不得 default-export 其他对象。pack 只从 `dsh-revbayes-forge/pack-api` 导入规格/渲染 helpers，避免在 pack 加载链里引入宿主侧的 `@deepseek-ai/dsh-tools`。
4. `enable()` 检查 `coreApi`、pack 依赖、analysis 级 `requires`，然后通过 core 注册 pack 工具；依赖不满足时返回 `blocked`，不产生半可用工具。
5. disabled pack 仍出现在 `listPacks()` / `revbayes_environment` 中，但工具不存在。

`@deepseek-ai/dsh-tools` 在 core 中声明为 **peerDependency**（本地开发用 devDependency），由 DSH 宿主提供单实例；不要把它装进 profile，否则宿主与插件会各自持有 scheduler symbol，导致所有工具调用报 `undefined (reading 'prepare')`。

## 3. 服务契约（coreApi = 1）

```js
{
  apiVersion: 1,
  config, catalog, blocks, assembly, paths,
  validateScript, applyFixes, diagnoseRuntime,
  findRevBayes, runRevBayes,
  registerPack(pack, ctx) -> { enable, disable, dispose },
  listPacks(), isPackEnabled(id, maturity?), isPackActive(id), getPack(id),
  registerBlock(block), getBlock(id), generateByPack(packId, analysis, spec, ctx),
  reportCoverage()
}
```

- `registerPack` 校验：id 唯一、kebab-case、semver、`coreApi === 1`、maturity、analysis/tool 唯一、依赖语法、依赖 DAG 无环；`enable()` 再检查安装/启用状态与 analysis `requires`。
- `findRevBayes`、`runRevBayes`、`applyFixes`、`diagnoseRuntime` 在服务上是 Promise 包装，保持宿主异步语义；同步内部实现仍由 core 的 rev 模块导出。
- 覆盖率有两个镜像：仓库审核用的 `coverage/families.yaml` 与 core 随包分发的 `src/data/families.json`（供 `reportCoverage()` 在任意安装形态下读取）。`scripts/coverage-report.mjs --check` 比较两者，防止漂移。

## 4. Block / Assembly

```js
const block = sectionBlock({
  id: 'data.character',
  title: 'Reading in the Data',
  order: 100,
  lines: ['data <- readDiscreteCharacterData("data.nex")'],
  variables: [{ name: 'data', kind: 'constant' }],
  provides: ['data.character'],
})
const result = createAssembly({ catalog }).add(block).finish()
// -> { script, sections, warnings, diagnostics, validation, stats }
```

- `requires` 能力未满足、变量重名、block 断言失败都会显式报错；
- section 按 `order` 稳定排序；
- assembly 可用 catalog 做严格静态自检；
- pack 的 `renderSections` 内部使用同一 assembly/sectionBlock 路径；
- core 的 DNA/Mk/分区基础生成器保留原有代码路径（输出不变），作为兼容基线；新 pack 脚本统一走 block assembly。

## 5. Recipe 与跨包组合

- pack 不 import 其他 pack；TED 用 `forge.assembly.recipe('ted').requirePack(...)` 检查依赖，再用 `generateByPack('fbd', ...)` 取基线脚本；
- PPS/model-selection 通过 `base_spec` 调用 `generateByPack`，或直接接受 `base_script`；
- recipe 检查失败返回结构化诊断，不生成半成品。

## 6. 诊断命名空间

- core：RB1xxx 语法、RB2xxx 名称、RB3xxx 签名、RB4xxx 语义/service、RB5xxx 生成、RB6xxx 运行时、RB58xx 写入。
- pack：FBD、DAT、COA、DIV、TRA、BIO、MOR、CHR、MOL、HOS、PPS、SEL、TED；每条 pack 诊断带 `source: "pack:<id>"`。

## 7. 版本与成熟度

- core `apiVersion = 1`、pack `coreApi = 1`；
- monorepo 各包版本以 lockstep 方式同步（见根 `package.json`，当前 0.1.0）；`meta-full` 精确锁定所有包版本；
- 成熟度默认策略：`verified` 默认启用，`golden` / `experimental` 需显式配置（`enabledPacks: all`、数组或设置页勾选）。

## 相关文档

- [model-packs](model-packs.md) — 13 个 pack 的分析、spec 与依赖
- [coverage](coverage.md) — 分析族覆盖与双镜像机制
- [settings-ui](settings-ui.md) — 设置页路由与热更新路径
