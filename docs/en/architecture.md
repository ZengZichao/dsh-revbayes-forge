# Architecture

RevBayes Forge is a single DSH plugin (`dsh-revbayes-forge`) that bundles a Rev parser, a static validator, a runtime harness, a help-signature catalog, a script assembler, and all 13 model packs. This page describes the layering, the pack lifecycle, and the service contract that packs and tools build on.

## 1. Layering

```text
DSH host
  ctx.tools / ctx.provide / ctx.effect
        │
core: dsh-revbayes-forge
  tools: generate / validate / lookup / environment
  service: revbayesForge (coreApi = 1)
  rev: parser / static validator / runtime / catalog
  blocks + assembly + recipe
        │ registerPack
  model/workflow packs (13, built into the core bundle)
        │ recipe / generateByPack
  orchestrator: ted
  meta: full
```

Key boundaries:

- Pack code is built into core. DSH installs and mounts exactly one bundle; `packages/pack-*` remain in the repository as development packages for fixtures, goldens, and runtime tests, and must not expose a second DSH bundle.
- Packs never import other packs. Cross-pack composition goes only through core's `recipe` / `generateByPack` (TED is the orchestrating example).
- Packs do not register tools or write files themselves. Core handles enable/disable, dependency checks, strict re-validation of every generated script, and the `output_path` policy.
- `forge.reconfigure()` enables packs in dependency-topological order (dependencies first, dependents after). Packs whose dependencies are unmet stay `blocked`; no half-working tool is ever registered.
- The settings page registers/unregisters tools in-process on save and persists the selection to `$DSH_HOME/revbayes-forge/state.json` (atomic write; it survives restarts).

## 2. Pack lifecycle

1. DSH loads core and calls `apply(ctx, config)`.
2. Core normalizes configuration, loads the signature catalog, creates the `revbayesForge` service, exposes it via `ctx.provide('revbayesForge', forge)`, and registers the 4 core tools.
3. DSH then applies each built-in pack. A pack's `apply` does exactly three things:
   - `forge.registerPack(manifest, ctx)` — the installed manifest is always registered;
   - if `forge.isPackEnabled(id, maturity)`: `registration.enable()`;
   - `ctx.effect(...)` registers a disposer so unloading calls `disable()` / `dispose()`.
   
   A pack entry must declare `inject = ['tools', 'revbayesForge']` (`enable()` registers tools through `ctx.tools`), its entry `name` must equal its own Cordis entry id, and it must not default-export any other object. Packs import spec/render helpers only from `dsh-revbayes-forge/pack-api`, so the pack load chain never pulls in the host-side `@deepseek-ai/dsh-tools`.
4. `enable()` checks `coreApi`, pack dependencies, and analysis-level `requires`, then registers the pack's tools through core. When dependencies are unmet it returns `blocked` instead of registering partial tooling.
5. A disabled pack still appears in `listPacks()` and `revbayes_environment`, but its tools do not exist.

`@deepseek-ai/dsh-tools` is declared by core as a **peerDependency** (devDependency for local development only) and is provided by the DSH host as a single instance; never install it into the profile, or host and plugin each hold their own scheduler symbol and every tool call fails with `undefined (reading 'prepare')`.

## 3. Service contract (coreApi = 1)

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

`registerPack` validates: unique kebab-case id, semver version, `coreApi === 1`, maturity, unique analyses/tools, dependency syntax, and an acyclic dependency DAG. `enable()` additionally checks install/enable state and analysis `requires`. `findRevBayes`, `runRevBayes`, `applyFixes`, and `diagnoseRuntime` are Promise-wrapped on the service to preserve host async semantics; their synchronous implementations are still exported by core's `rev` modules.

Coverage has two mirrors: the CI-reviewed `coverage/families.yaml` and `src/data/families.json`, which ships inside core so `reportCoverage()` works in any installation shape. `scripts/coverage-report.mjs --check` compares the two to prevent drift (see [coverage.md](coverage.md)).

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

- Unmet `requires` capabilities, duplicate variables, and failed block assertions raise explicit errors;
- sections are stably sorted by `order`;
- an assembly can run a strict static self-check against the catalog;
- pack `renderSections` implementations use the same assembly/sectionBlock path;
- the core DNA/Mk/partition generators keep their original code path (unchanged output) as a compatibility baseline; new pack scripts all go through block assembly.

## 5. Recipe and cross-pack composition

- Packs do not import other packs. TED checks its dependencies with `forge.assembly.recipe('ted').requirePack(...)` and then fetches the baseline script with `generateByPack('fbd', ...)`;
- pps and model-selection call `generateByPack` through a `base_spec`, or accept a `base_script` directly;
- a failed recipe check returns structured diagnostics; no half-assembled script is produced.

## 6. Diagnostic namespaces

Core: `RB1xxx` syntax, `RB2xxx` names/functions, `RB3xxx` signatures, `RB4xxx` semantics/service, `RB5xxx` generation, `RB6xxx` runtime, `RB58xx` writes.

Packs: `FBD`, `DAT`, `COA`, `DIV`, `TRA`, `BIO`, `MOR`, `CHR`, `MOL`, `HOS`, `PPS`, `SEL`, `TED`. Every pack diagnostic carries `source: "pack:<id>"`. See [validation-rules.md](validation-rules.md) for the full code tables.

## 7. Versions

- Core `apiVersion = 1`; packs require `coreApi = 1`.
- The monorepo is versioned in lockstep (`0.1.0` across packages).
- The `full` meta package pins the exact version of every package.
- `verified` packs are enabled by default; `golden` and `experimental` packs require explicit configuration (see [configuration.md](configuration.md)).
