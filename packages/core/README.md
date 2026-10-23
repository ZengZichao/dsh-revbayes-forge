# RevBayes Forge（`dsh-revbayes-forge`）

本目录是 DSH 插件 `dsh-revbayes-forge` 的本体，也是**唯一的 DSH bundle**：内置 4 个核心工具（`revbayes_generate` / `revbayes_validate` / `revbayes_lookup` / `revbayes_environment`）与全部 13 个模型包，并通过设置页（总览 / Packs / Environment / Generate / Validate）统一管理。

安装（要求 DSH `>= 0.2.1-rc.2`、Node `>= 20`）：

```sh
dsh plugin --profile desktop add file:"$PWD/packages/core"
```

安装后完全退出并重启 DeepSeek Harness，然后在设置页（RevBayes Forge → Packs）启用所需 pack。运行期配置（`revbayesBinary`、`allowRuntime`、超时、工作区、catalog、`enabledPacks`）写在 DSH profile 配置中，字段说明见 [docs/zh/configuration.md](../../docs/zh/configuration.md)。仓库总览与全部文档见根目录 [README.md](../../README.md)。

---

# RevBayes Forge (`dsh-revbayes-forge`) — English

This directory contains the DSH plugin `dsh-revbayes-forge`, **the only DSH bundle**: it ships the 4 core tools (`revbayes_generate` / `revbayes_validate` / `revbayes_lookup` / `revbayes_environment`) plus all 13 model packs, managed from the settings page (Overview / Packs / Environment / Generate / Validate).

Install (requires DSH `>= 0.2.1-rc.2`, Node `>= 20`):

```sh
dsh plugin --profile desktop add file:"$PWD/packages/core"
```

Fully quit and restart DeepSeek Harness afterwards, then enable the packs you need in the settings page (RevBayes Forge → Packs). Runtime configuration (`revbayesBinary`, `allowRuntime`, timeouts, workspace, catalog, `enabledPacks`) lives in the DSH profile config; see [docs/en/configuration.md](../../docs/en/configuration.md) for all fields. For the repository overview and all documentation, see the root [README.en.md](../../README.en.md).
