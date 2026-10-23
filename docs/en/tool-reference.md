# Tool Reference

The four core tools are registered by `dsh-revbayes-forge`; pack tools are registered by core on behalf of each enabled pack. Every tool accepts structured JSON, returns a canonical value, and is rendered to Markdown by the host's `output.render`. All 13 pack tools follow one shape, so the per-tool notes below focus on their key inputs.

## 1. Core tools

### `revbayes_generate`

Generates DNA / Mk / partitioned RevBayes scripts from a structured spec, then runs a strict static self-check on the result.

| Field | Required | Meaning |
| --- | --- | --- |
| `spec` | yes | `analysis` (`dna` / `morphology` / `partition`; may be omitted for partition specs), `data`, `substitution`, `tree`, `mcmc` |
| `output_path` | no | Where to write the script, relative to the session workspace |
| `overwrite` | no | Allow overwriting an existing file; default `false` |

Partitioned analyses: `data.partitions[] = { name, file, type, state_count?, taxa? }` combined with `substitution.per_partition[name]`; in that form `data.file` may be omitted. Core validates partition name/file/state-count/taxa consistency and emits per-partition CTMCs and monitors.

Generation coverage (core):

- DNA: JC, F81, K80, HKY, GTR; optional `+I` / `+G`
- Morphology: Mk with JC substitution, any observed state count
- Partitions: per-partition CTMC and monitor, shared tree, taxa consistency checks
- Trees: uniform topology or fixed tree; branch lengths fixed or estimated; exponential/gamma/lognormal/uniform priors
- MCMC: multiple chains, move schedule, sampling/screen frequencies, tuning intervals, output directory

### `revbayes_validate`

Validates a script through the full pipeline (see [validation-rules.md](validation-rules.md)).

| Field | Meaning |
| --- | --- |
| `script` or `path` | Exactly one of the two |
| `mode` | `auto` / `static` / `dry` / `smoke` |
| `strict` | Override the configured strict mode for this call |
| `apply_fixes` / `allow_risky_fixes` | Apply safe fixes / fixes that need review |
| `binary` / `workdir` / `timeout_ms` / `max_generations` | Per-call runtime overrides |

### `revbayes_lookup`

Searches the bundled catalog by name, alias, description, or method. The catalog is derived from the official RevBayes help database: 611 entries, 654 signatures, and 451 methods, plus 18 legacy functions and 27 generic methods. Results include usage, parameters, defaults, enumerations, and examples; legacy entries carry `legacy: true`.

### `revbayes_environment`

Reports the `rb` binary and version, catalog size, effective configuration, installed/enabled/blocked packs, active tools, configured-but-not-installed packs, and any uncovered analysis families.

## 2. Pack tools

| Tool | Pack | Key inputs |
| --- | --- | --- |
| `revbayes_generate_fbd` | fbd | data (matrix/taxa/fossils/counts), substitution, fbd, mcmc |
| `revbayes_generate_dating` | dating | data, tree, substitution, clock, calibrations/constraints, mcmc |
| `revbayes_generate_coalescent` | coalescent-demography | data/tree or sfs, demography, mcmc |
| `revbayes_generate_diversification` | diversification | tree, states, model, mcmc |
| `revbayes_generate_traits` | continuous-traits | continuous data, tree, model, mcmc |
| `revbayes_generate_biogeo` | biogeo | range/tree/features, epochs, model, mcmc |
| `revbayes_generate_morphology` | morphology-advanced | morphology, tree, state_count, mcmc |
| `revbayes_generate_chromosome` | chromosome | counts, tree, max_chromosome, mcmc |
| `revbayes_generate_molecular` | molecular-selection | codon/PoMo data, tree, model, mcmc |
| `revbayes_generate_host` | host-repertoire | host/parasite trees, association matrix, model, mcmc |
| `revbayes_pps` | pps | `base_script` or `base_spec`, replicates, thinning, output_dir |
| `revbayes_model_selection` | model-selection | `base_script` or `base_spec`, cats/burnin/generations, output_dir |
| `revbayes_generate_ted` | ted | `base_spec` (FBD), extant_taxa, calibrations, mcmc |

All pack tools also accept `spec`, `output_path`, and `overwrite`. Per-pack spec fields, data requirements, and limitations are documented in [model-packs.md](model-packs.md).

## 3. Output contract

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

- Normal packs produce a single artifact; `output_path` is a file.
- Workflow packs (pps, ted) produce multiple artifacts; `output_path` is a directory and artifact file names come from each artifact's `name`.
- Core runs a strict static validation on **every** artifact and owns the workspace/overwrite policy (`output_path` is write-protected): writes outside the workspace are refused unless `allowWriteOutsideWorkspace` is set, existing files require `overwrite: true`, workflow output directories must not contain `..`, and no user file is ever deleted. Violations surface as `RB58xx` (or `<PACK>58xx`) diagnostics.
- A result with `written: false` still contains the full script and diagnostics; the caller can save it themselves.

## 4. Enablement and visibility

- Pack not installed: its tool does not exist.
- Installed but disabled or blocked: its tool does not exist; `revbayes_environment` and the settings page state the reason.
- Missing dependency: the pack is `blocked` and no partial tool is registered.
- A `base_spec` pointing at a base pack that is not enabled returns an explicit workflow error — it never silently falls back to a DNA template.
