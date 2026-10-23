# RevBayes Forge (dsh-revbayes-forge)

中文：[README.md](README.md)（The two files mirror each other in structure and facts.）

RevBayes Forge (`dsh-revbayes-forge` v0.1.0, GPL-3.0) is a DeepSeek Harness (DSH) plugin for RevBayes script generation and validation. It turns "writing a RevBayes script" into a checkable pipeline: structured analysis spec → block assembly and script generation → static signature/structure validation → dry-run or short smoke run → diagnostics with suggested fixes. **One plugin manages all 13 model packs**: core loads every pack internally, the DSH plugin list shows a single RevBayes Forge entry, and the settings page provides Overview, Packs toggles, Environment detection, and full Generate/Validate interfaces.

## Features

- **4 core tools**: `revbayes_generate` (generation with strict self-checks), `revbayes_validate` (static/runtime validation with safe fixes), `revbayes_lookup` (611 help entries / 654 signatures / 451 methods, plus 18 legacy functions and 27 generic methods), and `revbayes_environment` (rb path/version, configuration, pack status).
- **13 built-in model packs**: the 6 `verified` packs are enabled by default, `golden`/`experimental` packs are switched on in the settings page; together they cover 18 analysis families, each pack registering its own generation tool.
- **Settings page with five tabs**: Overview (core status, catalog size, active tools), Packs (maturity badges + enable toggles), Environment (RevBayes detection), Generate (example specs + preview + write), Validate (static / dry / smoke).
- **State persistence**: pack selections and configuration are written to `$DSH_HOME/revbayes-forge/state.json` (temp + rename atomic write) and restored across restarts; runtime settings such as `revbayesBinary` still come from the profile config.
- **Coverage of the official tutorial corpus**: 304 tutorial scripts (43 official directories) are all mapped to the 18 analysis families; `coverage/reference-corpus.yaml` registers every reference directory (covered / excluded with reasons) and is cross-checked by the coverage gate.
- **Single-bundle install**: only core is installed as a DSH plugin; `packages/pack-*` are development fixture packages (golden scripts / canonical specs / fixtures / runtime tests) and `packages/meta-full` is a development meta package — none of them produce bundles.

## Architecture

```text
dsh-revbayes-forge  (the only DSH bundle)
  ├─ rev parser / static validator / runtime / catalog
  ├─ blocks + assembly + recipe
  ├─ revbayesForge service (coreApi = 1)
  │    ├─ 13 built-in packs: src/packs/builtin/*.js
  │    ├─ forge.reconfigure({ enabledPacks, packConfig })  ← settings-page hot reload
  │    └─ atomic persistence in $DSH_HOME/revbayes-forge/state.json
  ├─ tools: generate / validate / lookup / environment
  ├─ settings-page HTTP API: /plugins/dsh-revbayes-forge/*
  └─ settings-page React entry: lib/client.js (settings.section)

packages/pack-*  development fixture packages (fixtures/golden/runtime tests), no bundle
packages/meta-full  development meta package, no bundle
```

Key boundaries:

- Pack code is built into core; DSH installs and mounts a single bundle. `packages/pack-*` remain as development packages for goldens, fixtures, and runtime tests.
- Packs do not import other packs; cross-pack composition goes only through core `recipe` / `generateByPack` (TED works this way).
- Packs register no tools and write no files; core handles enable/disable, dependency checks, strict validation, and the `output_path` policy.
- `forge.reconfigure()` enables dependencies before dependents in topological order; packs with unsatisfied dependencies stay blocked, so half-functional tools never appear.
- Saving in the settings page registers/unregisters tools immediately and writes the selection to `$DSH_HOME/revbayes-forge/state.json` (atomic write, preserved across restarts).

Repository layout:

```text
.
├── packages/
│   ├── core/                      # dsh-revbayes-forge (the only bundle)
│   │   ├── src/packs/builtin/     # 13 built-in pack modules
│   │   ├── src/host/routes.js     # settings-page HTTP API
│   │   ├── src/state.js           # $DSH_HOME state file (atomic write)
│   │   └── lib/client.js          # settings-page React entry
│   ├── pack-fbd/ ... pack-ted/    # development fixture packages
│   └── meta-full/                 # development meta package
├── coverage/                      # 18 analysis families / 304 tutorial scripts + reference-corpus register
├── scripts/                       # test / coverage / corpus / DSH install gates
├── docs/                          # Chinese and English docs (see Documentation)
└── examples/                      # basic examples
```

## Quick start

Requirements: DSH `>= 0.2.1-rc.2`, Node `>= 20`. RevBayes is optional; static validation still works without `rb`.

```sh
npm install

# install core only (all 13 packs are built in)
dsh plugin --profile desktop add file:"$PWD/packages/core"
```

Fully quit and restart DeepSeek Harness, then open the settings page (DSH Settings → **RevBayes Forge**) and enable the packs you need. Verify the install:

```sh
dsh --profile desktop --dump-config | grep -A3 revbayes-forge
```

`scripts/verify-dsh-install.mjs` uses exactly this single-bundle install path and asserts that the profile dump contains only one `revbayes-forge` line and no `dsh-revbayes-forge-pack-*`.

## Tools

Core tools (registered with the plugin):

| Tool | Purpose |
| --- | --- |
| `revbayes_generate` | Generate DNA/Mk/partitioned scripts with strict self-checks; optional workspace write |
| `revbayes_validate` | Lexical/structure → signatures/arguments → semantics/files → dry/smoke; safe fixes |
| `revbayes_lookup` | 611 help entries, 654 signatures, 451 methods + 18 legacy functions, 27 generic methods |
| `revbayes_environment` | `rb` path/version, directories, configuration, pack status, coverage hints |

Pack tools (registered after enabling the pack in the settings page):

| Pack id | Tool | Analyses | Maturity |
| --- | --- | --- | --- |
| `fbd` | `revbayes_generate_fbd` | fbd, fbd_simple, fbd_range | verified |
| `dating` | `revbayes_generate_dating` | strict/relaxed clock, relative constraints, sequential, TimeFIG | verified |
| `coalescent-demography` | `revbayes_generate_coalescent` | multispecies coalescent, skyline, StairwayPlot | verified |
| `diversification` | `revbayes_generate_diversification` | birth-death, SSE, HiSSE, ClaSSE | verified |
| `continuous-traits` | `revbayes_generate_traits` | BM, OU, relaxed BM, multivariate | verified |
| `biogeo` | `revbayes_generate_biogeo` | DEC, GeoSSE, FIG, MultiFIG, TimeFIG | golden |
| `morphology-advanced` | `revbayes_generate_morphology` | Mkv, ancestral state, stochastic map | golden |
| `chromosome` | `revbayes_generate_chromosome` | ChromEvol, BiChroM, ChromoSSE | golden |
| `molecular-selection` | `revbayes_generate_molecular` | codon selection, PoMo, PoMoBalance | golden |
| `host-repertoire` | `revbayes_generate_host` | host repertoire | experimental |
| `pps` | `revbayes_pps` | posterior predictive workflow | golden |
| `model-selection` | `revbayes_model_selection` | stepping-stone, path sampling | golden |
| `ted` | `revbayes_generate_ted` | total-evidence dating orchestrator (depends on fbd + dating) | verified |

Default policy: when `enabledPacks` is unset (or before the first settings-page save), only `verified` packs are enabled; golden/experimental packs are enabled manually in the settings page. PPS and model selection accept `base_script` (inline text or a workspace path) or `base_spec` (resolved via core `generateByPack`); TED requires `fbd` + `dating` enabled through its manifest dependencies and composes the FBD baseline script.

## Documentation

The Chinese and English doc sets mirror each other: `docs/zh/*.md` and `docs/en/*.md` correspond one to one; this README and [README.md](README.md) also mirror each other.

English documentation (docs/en):

| Document | Contents |
| --- | --- |
| [docs/en/installation.md](docs/en/installation.md) | Installation, requirements, and the single-bundle install path |
| [docs/en/configuration.md](docs/en/configuration.md) | All configuration fields and enablement policy |
| [docs/en/architecture.md](docs/en/architecture.md) | core/pack/recipe/block contracts |
| [docs/en/tool-reference.md](docs/en/tool-reference.md) | Core tools and pack tools |
| [docs/en/model-packs.md](docs/en/model-packs.md) | Per-pack specs, data, and limitations |
| [docs/en/validation-rules.md](docs/en/validation-rules.md) | Static/runtime diagnostic rules |
| [docs/en/settings-ui.md](docs/en/settings-ui.md) | Settings page, host HTTP API, and persistence semantics |
| [docs/en/verification.md](docs/en/verification.md) | Test matrix, coverage, and release gates |
| [docs/en/coverage.md](docs/en/coverage.md) | 18 analysis families / 304 scripts ownership and reference-corpus register |

## Development

```sh
npm install
npm run verify        # checks + all unit/pack/workflow tests + coverage gate
npm run corpus        # static regression over the 544-script reference corpus (538 clean + 6 documented exceptions)
npm run coverage      # generate the 18-family / 304-script ownership report (coverage:check is the gate)
npm run test:runtime  # real RevBayes dry/smoke for verified packs (needs REVBAYES_BIN)
npm run verify:dsh    # install core into an isolated DSH_HOME and assert a single bundle line
```

Notes: without `REVBAYES_BIN` (or `revbayesBinary` in the profile config), `npm run test:runtime` skips explicitly instead of passing silently; set `REVBAYES_RUNTIME_ALL=1` to additionally run the optional runtime coverage of golden/experimental packs.

## Known limitations

1. Real RevBayes runtime tests require `REVBAYES_BIN` or `revbayesBinary` in the profile config.
2. Relative data paths inside generated scripts resolve against the script directory; place scripts next to the data or use absolute paths.
3. Cross-pack analyses such as TimeFIG/TED depend on recipe and service state; missing dependencies are blocked explicitly, never half-generated.
4. The settings page manages pack selection only; config such as `revbayesBinary`/timeouts/workspace must be changed in the profile config followed by a restart.
5. Generated scripts receive static self-checks only; scientific correctness requires domain review and validation on real data.

## License

GPL-3.0, matching RevBayes / RevScripter. Files in `fixtures/` are synthetic small datasets unless their sources say otherwise, distributed with the repository under GPL-3.0; tutorial data with unclear licensing is not copied. Catalog directories derived from the official RevBayes help retain the upstream attribution.
