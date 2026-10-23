# 安装

dsh-revbayes-forge（RevBayes Forge）是 DeepSeek Harness（DSH）的单 bundle 插件：core 一个包内置全部 13 个模型 pack 与设置页，DSH 插件列表中只有一个条目。本文说明环境要求、安装步骤、安装验证、状态持久化与卸载；配置项详见 [configuration](configuration.md)。

## 1. 环境要求

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| DeepSeek Harness（DSH） | >= 0.2.1-rc.2 | 插件加载、工具注册与设置页 HTTP API 依赖的宿主版本 |
| Node.js | >= 20 | monorepo `engines` 要求 |
| RevBayes | 1.4.1（可选） | 没有真实 `rb` 时静态校验仍完全可用；dry/smoke 运行时校验需要真实二进制 |
| @deepseek-ai/dsh-tools | 0.2.1-rc.2 | core 的 peerDependency，由 DSH 宿主提供单实例；**不要**把它安装进 profile，否则宿主与插件各自持有 scheduler symbol，所有工具调用会报 `undefined (reading 'prepare')` |

`revbayesBinary` 未配置时，插件按 `REVBAYES_BIN` → `REVBAYES` → `RB_BIN` → `PATH` → 常见安装路径的顺序查找 `rb`。

## 2. 安装步骤

```sh
git clone <repo-url> dsh-revbayes-forge
cd dsh-revbayes-forge
npm install

# 只安装 core 一个插件（13 个 pack 全部内置）
dsh plugin --profile desktop add file:"$PWD/packages/core"
```

- 安装后**完全退出并重启 DeepSeek Harness**：宿主需要重新加载插件进程，设置页路由与状态文件才会挂载。
- 不要安装 `packages/pack-*` 或 `packages/meta-full`：它们只是开发夹具包（golden/夹具/运行时测试与版本锁定），不再产出 bundle。profile dump 中出现 `dsh-revbayes-forge-pack-*` 即为旧版安装残留，应清理。
- Windows 下在 Git Bash / POSIX shell 中执行上述命令；`$PWD` 为仓库根目录。

## 3. 验证安装

```sh
dsh --profile desktop --dump-config | grep -A3 revbayes-forge
```

期望输出恰好一个 bundle 行：

```yaml
- id: dsh-revbayes-forge
  name: dsh-revbayes-forge
```

且 dump 中没有任何 `dsh-revbayes-forge-pack-*` 行。

`npm run verify:dsh` 运行隔离安装门禁（`scripts/verify-dsh-install.mjs`）：

1. 创建临时 `DSH_HOME`，不触碰用户现有 profile；
2. 通过 DSH CLI 把 core 安装进隔离 profile；
3. 断言 profile dump 恰好含一个 RevBayes Forge bundle 行、无 pack bundle 行；
4. 检查安装目录中存在 `lib/client.js`、`src/packs/builtin/index.js`、`cordis.patch.yml`，且 profile 未捆绑本地 `@deepseek-ai/dsh-tools` 副本；
5. 清理临时目录。

脚本找不到 `dsh` CLI 时输出 `SKIP` 并以 0 退出（不会伪造失败或成功）。CLI 解析顺序：`DSH_JS`（直接指定 `lib/bin.js`）→ `DSH_BIN` → PATH 中的 `dsh`。安装结果也可以在 DSH 内调用 `revbayes_environment` 工具或打开设置页总览确认。

## 4. 状态与持久化

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 插件 config | profile 的 `cordis.patch.yml` | `revbayesBinary`、超时、`enabledPacks` 等；修改后重启 DSH 生效 |
| 设置页选择 | `$DSH_HOME/revbayes-forge/state.json` | `{ version: 1, enabledPacks: [...], packConfig: {...}, updatedAt }` |

- 状态文件写入是原子的（临时文件 + `rename`），崩溃不会留下半写文件。
- 损坏或非法的状态文件会被忽略并记录日志警告，不会导致插件启动失败。
- 设置页“保存并应用”后 pack 工具立即注册/注销；重启 DSH 后读取同一状态文件，选择保留、无需重新配置。
- 设置页不会改写 profile 的 `cordis.patch.yml`；`revbayesBinary`、超时、工作区等 config 仍由 profile 管理。
- `DSH_HOME` 未设置时默认为 `~/.dsh`；`stateFile` 配置可把状态文件指到其他路径。

## 5. 卸载

```sh
dsh plugin --profile desktop remove dsh-revbayes-forge   # 以所用 DSH 版本的 CLI 帮助为准
rm -rf "$DSH_HOME/revbayes-forge"                        # 删除状态目录（可选）
```

- 如有需要，再从 profile 的 `cordis.patch.yml` 中删除该插件的 `config:` 覆盖段。
- 完全退出并重启 DSH 后，插件列表与设置页条目消失。
- 状态目录只保存 pack 启用选择；删除后重新安装会回到默认策略（`verified` pack 启用）。

## 相关文档

- [configuration](configuration.md) — 全部配置键与启用策略
- [settings-ui](settings-ui.md) — 设置页与 Host HTTP API
- [verification](verification.md) — 安装门禁 `verify:dsh` 所在的完整门禁清单
