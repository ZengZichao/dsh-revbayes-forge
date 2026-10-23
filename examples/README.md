# Examples

Each `specs/*.json` file is an input for `revbayes_generate`. The matching
`*.Rev` file is the generated script, already checked against the bundled
RevBayes signature catalog and dry/smoke-tested with RevBayes 1.4.1.

Run an example from this directory:

```sh
rb dna_gtr_g_i.Rev
```

Files:

| Spec | Generated script | Shows |
| --- | --- | --- |
| `dna-jc-uniform.json` | `dna_jc_uniform.Rev` | Minimal JC + uniform topology + exponential branch lengths |
| `dna-gtr-g-i.json` | `dna_gtr_g_i.Rev` | GTR + discrete gamma + invariant sites, two runs, outgroup |
| `dna-fixed-tree.json` | `dna_fixed_tree.Rev` | Fixed tree and branch lengths, HKY parameters still estimated |
| `morphology-mk.json` | `morphology_mk.Rev` | Standard morphology (Mk/JC) with gamma rates |
| `partition-dna.json` | `partition_dna.Rev` | Partitioned DNA with per-partition GTR/HKY models and monitors |

`data/demo_dna.nex`, `data/demo_morph.nex`, and `data/demo.tre` are small
synthetic fixtures. `output/` exists (with a README placeholder) so the
monitors can write immediately.
The scripts use paths relative to this directory (`data/...`, `output/...`), so
start RevBayes here or adjust the paths.

To regenerate the scripts from their specs, run from the plugin root:

```sh
node scripts/generate-examples.mjs
```
