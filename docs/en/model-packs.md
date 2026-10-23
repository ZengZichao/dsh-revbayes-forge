# Model Packs

The 13 model packs are independent DSH bundles logically, but all of them are internal modules of the core bundle: each depends on core and none imports another pack. All share the same input/output conventions — `spec`, `output_path`, `overwrite` — with normal packs writing a single file and workflow packs writing an artifact directory. See [tool-reference.md](tool-reference.md) for the common output contract and [validation-rules.md](validation-rules.md) for per-pack diagnostic prefixes.

## 1. fbd (verified)

Analyses: `fbd`, `fbd_simple`, `fbd_range`.

```json
{
  "analysis": "fbd",
  "name": "fbd_demo",
  "data": { "file": "bears_morphology.nex", "taxa_file": "bears_taxa.tsv", "matrix_file": "bears_morphology.nex", "type": "Standard", "state_count": 2 },
  "substitution": { "model": "Mk", "gamma": { "categories": 4 } },
  "fbd": { "lambda": 1.0, "mu": 0.2, "psi": 0.1, "rho": 1.0, "origin": 45.0 },
  "mcmc": { "generations": 20000, "sample_every": 10 }
}
```

`fbd_range` takes `data.file` as a stratigraphic-ranges TSV, `data.fossil_counts_file` as a counts table, and requires at least two boundaries in `fbd.timeline`. Invariants: every fossil taxon must occur in the data/tree; range min/max must be valid; rates must be non-negative; `mu < lambda`; a fixed tree gets no topology move.

## 2. dating (verified)

Analyses: `strict_clock`, `relaxed_clock`, `relative_constraints`, `sequential`, `timefig_dating` (golden; requires the biogeo pack).

Inputs: character data, time tree, substitution, clock (`strict` / `relaxed_lognormal` / `relaxed_exponential`), calibrations, mcmc. `relative_constraints` needs `constraints.file`; `timefig_dating` needs `biogeo.range_file`. Invariants: the tree must be rooted and time-scaled; constraints must be compatible with the root age; clock rate > 0.

## 3. coalescent-demography (verified)

Analyses: `multispecies_coalescent`, `skyline`, `stairwayplot`.

- MSC: `data.file` plus `data.species_tree`, with `demography.population_size`;
- skyline: alignment plus gene tree, with `demography.windows`;
- stairwayplot: an `sfs` array (≥ 3 entries), `intervals`, `mutation_rate`, `generation_time`.

Invariants: complete locus/taxon mapping; population sizes > 0; non-negative SFS entries.

## 4. diversification (verified)

Analyses: `birthdeath`, `sse`, `hisse`, `classe`.

`birthdeath` needs only `data.tree`. The SSE variants need `data.states_file` and `data.num_states`, with `sampling ∈ [0,1]` and `death < birth` enforced. Emits `dnBDP` or `dnCDBDP`.

## 5. continuous-traits (verified)

Analyses: `bm`, `ou`, `relaxed_bm`, `multivariate`.

Inputs: a continuous matrix, a time tree, and `model.sigma2/alpha/theta/dimensions/root_states`. Invariants: trait indices valid; `sigma2`/`alpha` > 0; `dimensions` ≥ 2 for the multivariate analysis.

## 6. biogeo (golden)

Analyses: `dec`, `geosse`, `fig`, `multifig`, `timefig`.

Inputs: ranges/tree/features, `data.areas`, `model.dispersal/extirpation`; TimeFIG needs `epochs`. Invariants: ranges must be valid for the area set; adjacency and epoch ordering must be consistent; FIG features must align with areas/epochs. The historical `*_orig`/`hoehna` tutorial variants are covered for validation purposes only.

## 7. morphology-advanced (golden)

Analyses: `mkv`, `ancestral_state`, `stochastic_map`.

Inputs: morphology data, tree, `state_count`, optional gamma. Mkv uses `coding="variable"`; ancestral-state reconstruction appends `mnJointConditionalAncestralState` and an `ancestralStateTree` summary; the stochastic map appends `mvCharacterHistory` / `mnStochasticCharacterMap`. The core Mk generation path stays independent — the advanced pack never falls back to it.

## 8. chromosome (golden)

Analyses: `chromevol`, `bichrom`, `chromosse`.

Inputs: a counts TSV, a tree, and `model.max_chromosome/gain/loss/polyploidy`. Invariants: counts ≤ max chromosome number; state space consistent with the data; non-negative rates.

## 9. molecular-selection (golden)

Analyses: `pomo`, `pomobalance`, `codon_selection`.

PoMo uses `readPoMoCountFile` + `fnReversiblePoMo` with `type="PoMo"`; codon analyses use `translateCharacters("Codon")`, `fnCodonHKY`, and `type="Codon"`. Invariants: virtual population size, number of states, and genetic code/phase must be consistent with the data.

## 10. host-repertoire (experimental)

Analysis: `host_repertoire` — host and parasite trees plus an association matrix. The model includes switch rates, `fnHostSwitchRateModifier`, `fnRateGeneratorSequence`, `dnPhyloCTMCDASequence`, and character-history moves. It generates a single script with strong data dependencies and is not enabled by default. As of RevBayes 1.4.1 the optional real-binary runtime coverage still fails at the character-history proposal; experimental maturity explicitly allows this, and the pack should only be promoted after a domain review.

## 11. pps (golden)

Tool: `revbayes_pps`. Analyses: `pps`, `pps_morphology`, `posterior_predictive`.

Input: a `base_script` (inline text or a workspace path) or a `base_spec`; `replicates > 0` and `thinning > 0`. Output is two artifacts: the main PPS script and a simulation-only script. Canonical goldens cover both the DNA (`pps`) and morphology (`pps_morphology`) paths. A trailing `q()` on the base script is stripped; the output directory must not contain `..`.

## 12. model-selection (golden)

Tool: `revbayes_model_selection`. Analyses: `stepping_stone`, `path_sampling`, `marginal_likelihood`.

Input: base_script/base_spec, `cats ≥ 2`, `burnin`, `generations`, `sample_freq`. The generator creates a `powerPosterior` and appends `steppingStoneSampler` / `pathSampler` according to the chosen method. These computations are expensive; CI always uses minimal step counts.

## 13. ted (verified)

Tool: `revbayes_generate_ted`. Analyses: `ted`, `ted_range`.

Requires the `fbd` and `dating` packs (both installed and enabled). Dependencies are checked through a recipe; the FBD baseline script is fetched with core `generateByPack('fbd', ...)`, then extant clade ages, an optional calibration, TED monitors, and the MCMC are appended. With either dependency missing, the pack is `blocked` and its tool is not registered. The official `ted_workflow` directory contains 31 files including headers and fragments; acceptance is based on 2–3 canonical workflows.

## 14. Default enablement

- `verified` (enabled by default): fbd, dating, coalescent-demography, diversification, continuous-traits, ted;
- `golden` (enabled via `enabledPacks: all` or an explicit list / settings page): biogeo, morphology-advanced, chromosome, molecular-selection, pps, model-selection;
- `experimental` (explicit opt-in only): host-repertoire.

Pack fixtures are small synthetic datasets; golden comparisons normalize dates and whitespace before comparing. See [configuration.md](configuration.md) for the `enabledPacks` semantics and [coverage.md](coverage.md) for how packs map onto the official tutorial corpus.
