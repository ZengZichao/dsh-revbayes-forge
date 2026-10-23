# Official Documentation Coverage

RevBayes Forge measures its scope against the official RevBayes documentation: the tutorial corpus at revbayes.github.io and the official help database behind `rb`'s help system. This page states exactly what is covered, what is excluded and why, and how a repository gate enforces the statement, so the coverage claim can be checked rather than trusted.

## 1. Benchmark

The benchmark is **revbayes.github.io/tutorials**, which publishes 52 topic directories. Every directory is registered in `coverage/reference-corpus.yaml` with one of two statuses: `covered` (mapped to an analysis family) or `excluded` (with a documented reason). The register is the single source of truth; nothing outside it is claimed.

## 2. Coverage statement

- **43 of the 52 directories contain Rev scripts** — 304 scripts in total — and every one of them is mapped into one of the **18 analysis families** (`coverage/families.yaml`), with each family owned by core or by a specific pack.
- **`fig_intro`** is covered by the biogeo pack's `fig` analysis, even though the page itself contains no Rev code blocks; the FIG model workflow it describes is what the pack generates.
- The **remaining 8 directories are excluded** with documented reasons (next section). 43 + `fig_intro` + 8 = 52.

## 3. Excluded directories

| Directory | Reason (per `coverage/reference-corpus.yaml`) |
| --- | --- |
| `concatenation` | Legacy redirect page (RB_GeneConcatenation_Tutorial) de-indexed by the official site; contains no Rev code blocks |
| `convergence` | Guidance page for the external R package Convenience; contains no Rev code blocks to generate |
| `dice` | Conceptual hand-simulation walkthrough of CTMC mechanics; contains no Rev code blocks |
| `quick_tips` | Prose-only tips page with no Rev code blocks; not listed in the official tutorial index |
| `mcmc_old` | Legacy duplicate of the indexed mcmc_troubleshooting tutorial; de-indexed by the official site |
| `multispecies_coalescent` | Legacy redirect page (RB_MultispeciesCoalescent_Tutorial); the topic is covered by the indexed `species_tree` and `coalescent` tutorials |
| `revscripter` | Walkthrough of the RevScripter GUI application, out of scope for a script-generation plugin |
| `tikz` | Incomplete LaTeX/TikZ figure-drawing tutorial with no Rev code blocks |

## 4. Family mapping

| Family | Tutorial directories | Scripts | Owners | Maturity |
| --- | --- | --- | --- | --- |
| standard_dna | ctmc | 5 | core | verified |
| morphology_tree | morph_tree | 12 | core, pack-morphology-advanced | mixed |
| morphology_asr | morph_ase, morph | 15 | pack-morphology-advanced | golden |
| partition | partition | 6 | core | verified |
| dating_clock | dating, clocks, relative_time_constraints, sequential_bayes, timefig_dating | 43 | pack-dating-clock | mixed |
| coalescent | coalescent, species_tree | 44 | pack-coalescent-demography | verified |
| fbd_ted | fbd, fbd_simple, fbd_range, ted_workflow | 43 | pack-fbd, pack-ted | verified |
| diversification | divrate, sse | 22 | pack-diversification | verified |
| continuous_traits | cont_traits | 24 | pack-continuous-traits | verified |
| biogeo | biogeo, biogeo_hoehna, geosse, geosse_orig, multifig, multifig_orig, timefig_simple, timefig_orig | 12 | pack-biogeo | golden |
| chromosome | chromo | 6 | pack-chromosome | golden |
| selection_codon | selection | 3 | pack-molecular-selection | golden |
| pomo | pomos, pomobalance | 2 | pack-molecular-selection | golden |
| host_repertoire | host_rep | 1 | pack-host-repertoire | experimental |
| stairwayplot | stairwayplot | 5 | pack-coalescent-demography | verified |
| pps | model_testing_pps, model_testing_ppred_inf, pps_morpho, intro_posterior_prediction | 36 | pack-pps | golden |
| model_selection | model_selection_bayes_factors | 9 | pack-model-selection | golden |
| basics | mcmc, intro, mcmc_troubleshooting, docker, tutorial_structure | 16 | core | validation |

The family table drives `revbayes_environment`'s uncovered-families report and the settings page Overview tab: a family whose owner pack is disabled shows up as uncovered at runtime.

## 5. Help catalog

The help catalog used by `revbayes_lookup` and by static signature validation is derived from the official RevBayes **help database** (the same source as the `rb` help system): 611 entries, 654 signatures, and 451 methods, plus 18 legacy functions and 27 generic methods. The catalog build retains its upstream provenance notes; `catalogPath` can point at an external catalog JSON to swap in a newer snapshot (see [configuration.md](configuration.md)).

## 6. Workshops

Official workshop materials are course curricula assembled from the same tutorial content; they introduce no tutorial directories or scripts beyond the ones already registered above, so they are covered transitively and carry no separate register entries.

## 7. How the gate enforces this

`npm run coverage` (report) and `npm run coverage:check` (gate, fails on any violation) run `scripts/coverage-report.mjs`, which:

- validates `coverage/families.yaml` against `coverage/tutorial-index.json`: exactly 18 families, script total 304, per-family declared script counts matching the committed per-directory index, every indexed tutorial mapped to exactly one family, every owner present as a package;
- verifies the runtime mirror `packages/core/src/data/families.json` is identical to the CI-reviewed YAML (counts, maturity, owners, tutorials, and `meta.tutorialScripts = 304`), so `reportCoverage()` never drifts from this page;
- enforces the single-bundle structure: core declares `@deepseek-ai/dsh-tools` only as a peer, `cordis.patch.yml` inserts exactly one bundle, and all 13 pack modules are built into core with fixtures, goldens, and (for verified packs) dry+smoke runtime tests;
- reads `coverage/reference-corpus.yaml` and checks its internal consistency (declared directory count matches entries, covered entries map to a real family, excluded entries carry a reason);
- when the reference tutorial tree is available locally (`--root`, the `REVBAYES_TUTORIALS` environment variable, or the default sibling reference checkout), cross-checks it: the actual `.Rev` count of every indexed directory must match the index, the total must be 304, and every directory present in the reference tree must be registered in `coverage/reference-corpus.yaml` (and vice versa).

Because the register and the tree are cross-checked whenever the reference checkout is available, adding an unregistered tutorial directory or dropping a covered one fails the gate instead of silently shrinking the coverage statement. Related gates are described in [verification.md](verification.md); what the families buy you at generation time is in [model-packs.md](model-packs.md).
