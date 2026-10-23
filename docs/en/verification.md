# Verification and Release Gates

This page lists the automated gates that guard the plugin, what each one asserts, and the commands to run them. All gates are runnable from the repository root; runtime and DSH gates require external binaries (`rb`, the `dsh` CLI) and degrade explicitly — they skip, never fake success — when those binaries are absent.

## 1. Test matrix

| Layer | Content | Command |
| --- | --- | --- |
| Syntax check | `node --check` over every shipped JavaScript module | `npm run check` |
| Core unit | parser, static validator, runtime, catalog, generator | `node --test packages/core/test/*.test.js` |
| Core service | pack lifecycle, dependencies, recipe, block/assembly, partitions, legacy catalog, pack tool writes | same |
| Pack unit | manifests, spec validation, canonical goldens, invalid specs, tool registration | `npm test` |
| Workflow | pps / model-selection `base_script` and `base_spec`; TED recipe and dependency blocking | `npm test` |
| Corpus | 544 reference `.Rev` scripts validated statically; only the 6 documented exceptions may fail | `npm run corpus` |
| Coverage | 18 families / 304 scripts, owners, golden fixtures, verified-pack runtime fixtures, meta lockstep, single-bundle invariants | `npm run coverage:check` |
| Real `rb` (required) | one canonical script per verified pack, dry + smoke | `REVBAYES_BIN=... npm run test:runtime` |
| Real `rb` (optional) | runtime coverage for golden/experimental packs | `REVBAYES_RUNTIME_ALL=1 REVBAYES_BIN=... npm run test:runtime` |
| DSH install | installs core into an isolated `DSH_HOME` and asserts exactly one bundle row and no pack rows | `npm run verify:dsh` |
| CI | unit + coverage; runtime and DSH gates are enabled by repository variables | `.github/workflows/verify.yml` |

`npm run verify` chains `check` + `test` + `coverage:check` and is the default pre-commit gate.

## 2. Reference corpus

`npm run corpus` (`scripts/validate-corpus.mjs`) statically validates every `.Rev` file in the reference tutorial checkout against the bundled catalog. 544 reference scripts are expected; exactly 538 must be clean. The 6 known non-valid scripts are registered in the script and may fail:

```text
tutorials/mcmc_troubleshooting/scripts/inference.Rev
tutorials/mcmc_troubleshooting/scripts/models.Rev
tutorials/mcmc_troubleshooting/scripts/moves.Rev
tutorials/mcmc_troubleshooting/scripts/startingvals.Rev
tutorials/model_selection_bayes_factors/scripts/marginal_likelihood_partition_1.Rev
tutorials/model_selection_bayes_factors/scripts/marginal_likelihood_partition_4.Rev
```

The first four are tutorial prose/code fragments; the last two are themselves missing parentheses. Any failure outside this list fails the gate, so validator changes cannot silently regress on real tutorial scripts. The corpus root defaults to a sibling reference checkout and can be overridden with `--root`.

## 3. Per-pack definition of done

- manifest: id / version / coreApi / maturity / analyses / tools / dependencies;
- spec schema plus semantic validation, exercised by at least 3 invalid-spec tests;
- at least one canonical golden (date/whitespace-normalized comparison);
- tool registration / disable / dependency-blocked tests;
- for `verified` packs: dry + smoke fixtures in `runtime.test.mjs` that pass against a real `rb`;
- a coverage entry with per-script documentation (see [coverage.md](coverage.md));
- a pack README documenting fixtures and their provenance;
- a recorded domain review per pack; external scientific sign-off is tracked as pending.

## 4. Release checklist

```sh
npm run verify              # check + tests + coverage gate
npm run corpus              # 544-script static regression
REVBAYES_BIN=<path-to-rb> npm run test:runtime
npm run verify:dsh          # isolated DSH_HOME install gate
npm pack --dry-run --workspace packages/core
npm pack --dry-run --workspace packages/pack-fbd
npm pack --dry-run --workspace packages/meta-full
```

Real-`rb` compatibility matrix:

| RevBayes | Platform | Role |
| --- | --- | --- |
| 1.4.1 | Windows x86_64 | primary validation platform |
| 1.4.1 | macOS arm64 | baseline |
| 1.4.1 | Linux x86_64 | CI target |

Runtime tests require a real RevBayes 1.4.1 binary via `REVBAYES_BIN` (or `revbayesBinary` in the profile config). When `REVBAYES_BIN` is unset, runtime tests skip explicitly — they never report a false pass. `npm run test:runtime` requires only the verified packs by default; golden/experimental coverage is opt-in with `REVBAYES_RUNTIME_ALL=1`.

## 5. DSH install gate

`npm run verify:dsh` runs `scripts/verify-dsh-install.mjs`:

1. create a temporary `DSH_HOME`;
2. bootstrap the test profile from the default `web` profile (`dsh --profile forge-test --from-default-profile web --dump-config`);
3. `dsh plugin --profile forge-test add file:<core>`;
4. dump the profile and assert: the string `revbayes-forge` is present, no `dsh-revbayes-forge-pack-*` row exists, and exactly one bundle row with id `dsh-revbayes-forge` is mounted;
5. assert the installed bundle contains `lib/client.js`, `src/packs/builtin/index.js`, and `cordis.patch.yml`, and that no local `@deepseek-ai/dsh-tools` copy was pulled into the profile (it must come from the host);
6. remove the temporary directory. User profiles are never touched.

CLI resolution order: `DSH_JS` (a direct path to a DSH `lib/bin.js`) → `DSH_BIN` → `dsh` on `PATH`. With `DSH_NPX=1` the script runs `npx --yes @deepseek-ai/dsh@0.2.1-rc.2`. When no CLI is available and none of the variables are set, the script prints `SKIP` and exits 0.
