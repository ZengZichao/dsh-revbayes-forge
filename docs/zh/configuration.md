# 配置

插件配置在 profile 的 `cordis.patch.yml` 中按插件 id 覆盖，修改后重启/重载 DSH 生效。设置页只管理 pack 启用选择（写入状态文件并热更新，见 [settings-ui](settings-ui.md)），不会修改 YAML。字段语义以 `packages/core/cordis.patch.yml` 注释与本文为准。

```yaml
- id: dsh-revbayes-forge
  name: dsh-revbayes-forge
  config:
    revbayesBinary: /usr/local/bin/rb
    allowRuntime: true
    defaultMode: auto
    defaultRuntimeMode: dry
    timeoutMs: 120000
    maxRunGenerations: 100
    keepTemp: false
    strict: false
    checkFiles: true
    maxDiagnostics: 50
    maxScriptBytes: 1048576
    allowWriteOutsideWorkspace: false
    enabledPacks: default
    packConfig:
      fbd:
        strictTaxonomy: true
```

## 1. 运行时与校验字段

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `revbayesBinary` | `""` | `rb` 路径；空则按 `REVBAYES_BIN` → `REVBAYES` → `RB_BIN` → `PATH` → 常见安装路径查找 |
| `allowRuntime` | `true` | 是否允许 dry/smoke 执行 |
| `defaultMode` | `auto` | `auto` / `static` / `dry` / `smoke` |
| `defaultRuntimeMode` | `dry` | `auto` 模式实际执行的运行时模式（`dry` / `smoke`） |
| `timeoutMs` | `120000` | 子进程超时（1000–1800000） |
| `maxRunGenerations` | `100` | smoke 最大代数 |
| `keepTemp` | `false` | 保留运行时临时目录 |
| `tempRoot` | `""` | 临时目录根；空 = OS 临时目录 |
| `catalogPath` | `""` | 外部签名目录 JSON（需绝对路径）；空 = 使用内置目录 |
| `strict` | `false` | 将未知函数 / loose 签名上的未知参数提升为 error |
| `checkFiles` | `true` | 静态校验时检查引用的数据/树文件是否存在 |
| `maxDiagnostics` | `50` | 返回诊断上限（1–500） |
| `maxScriptBytes` | `1048576` | 校验脚本大小上限 |
| `stateFile` | `""` | 状态文件路径覆盖（需绝对路径）；空 = `$DSH_HOME/revbayes-forge/state.json` |
| `allowWriteOutsideWorkspace` | `false` | 允许写入工作区外路径 |
| `workspace` | `""` | 工作区根目录覆盖；空 = 调用会话的工作目录。相对路径基于它解析，写保护也以它为界 |

## 2. Pack 字段

| 字段 | 默认 | 行为 |
| --- | --- | --- |
| `enabledPacks` | `default` | pack 启用选择器，取值见下表 |
| `packConfig` | `{}` | 按 pack id 传给 pack 的只读配置；字段语义由各 pack 自行解释 |

### 2.1 enabledPacks 取值

| 取值 | 行为 |
| --- | --- |
| `default` | 启用所有已安装的 `verified` pack（fbd、dating、coalescent-demography、diversification、continuous-traits、ted） |
| `all` | 启用所有已安装 pack（含 `golden` 与 `experimental`） |
| `none` | 仅保留 core 的 4 个工具，不启用任何 pack |
| 数组 | 仅启用列出的 pack id，如 `[fbd, dating]`；id 必须是合法 kebab-case pack id |

### 2.2 packConfig

- 键必须是合法 pack id，值必须是对象（映射），否则配置规范化报错。
- 配置以只读对象传给 pack，由 pack 自行解释字段；例如 `fbd` 的 `strictTaxonomy: true` 收紧分类单元命名检查。
- 设置页保存后，状态文件中的 `packConfig` 按 pack id 与 profile 配置合并，状态文件中的同名字段优先生效。

## 3. 启用语义与边界

- 配置了未安装的 pack：不报错；`revbayes_environment` 在 `configured_missing` 中显示。
- disabled pack 仍注册 manifest（environment 显示 installed-but-disabled）；pack 工具只在 `enable()` 之后注册。
- 禁用某个 pack 后，`revbayes_validate` 仍可校验该分析族的手写脚本。
- YAML 中的启用/禁用需要重启 DSH 生效；运行时热开关由设置页负责（写状态文件并热更新）。设置页保存过一次后，状态文件中的启用列表整体覆盖 profile 的 `enabledPacks` 选择器。
- `blocked`（依赖缺失）与 `disabled`（未启用）不同：blocked 的 pack 不注册任何工具，environment 给出原因。

## 4. 路径与写入保护

- 相对路径基于调用会话的工作区解析。
- 默认拒绝写工作区外路径（core `RB58xx` / 各 pack 前缀 `58xx`）；确需放开时设 `allowWriteOutsideWorkspace: true`。
- 普通 pack 的 `output_path` 是文件路径；workflow pack（pps/ted）产出多个 artifact 时，`output_path` 视为目录，文件名取 artifact 的 `name` 并做 basename 防逃逸。
- 已存在文件默认拒绝覆盖，传 `overwrite=true` 才覆盖；插件不删除用户已有的 `.Rev` 或输出文件。

## 相关文档

- [installation](installation.md) — 安装与状态文件位置
- [model-packs](model-packs.md) — 各 pack 的 spec 字段与限制
- [validation-rules](validation-rules.md) — `strict` 语义与诊断代码
