# Validation Rules and Diagnostic Codes

RevBayes Forge validates scripts in three tiers: static analysis (lexing, structure, signatures, semantics, files) followed by optional real-binary dry-run and smoke execution. Every problem is reported as a structured diagnostic with a stable code in one of the namespaces described below. `revbayes_validate` and the settings-page Validate tab expose the same pipeline.

## 1. Validation tiers

| Tier | Entry point | Starts RevBayes | Purpose |
| --- | --- | --- | --- |
| Structure / signatures / semantics | `validateScript()` | no | Catch syntax, function, argument, and model-assembly problems before an expensive run |
| Dry-run | `runRevBayes({ mode: 'dry' })` | yes | Actually execute data reading and model/tree/move/monitor/MCMC construction |
| Smoke | `runRevBayes({ mode: 'smoke' })` | yes | Sample for a small number of generations to exercise moves, monitors, and the run path |

`auto` starts from the static tier. If the static tier produced an error, runtime execution is disabled, or no `rb` binary can be found, only the static result is returned.

## 2. Static checks

### 2.1 Lexical / structural (RB1xxx)

- Unterminated strings (RB1002), illegal characters (RB1001);
- unbalanced parentheses / braces / brackets;
- missing separators between statements (RB1101), unparseable tokens (RB1103/1105);
- incomplete `for`/`while`/`if` headers (RB1110–1131);
- missing comma or closing parenthesis in call argument lists (RB1142/1143);
- index / matrix subscripts (RB1140/1141);
- function parameter lists and bodies (RB1104/116x).

The parser is **tolerant**: after a bad statement it skips to the next statement boundary and keeps reporting later problems; one broken line never swallows the rest of the file.

Covered Rev syntax includes:

- `<-`, `:=`, `~`, `=`, `+=`, `-=`, `*=`, `/=`, `%=`;
- positional and named arguments, trailing commas, multi-line calls;
- `for (i in 1:n) {}`, `while`, `if/else if/else`;
- `function (x) ...` and typed declarations such as `function RealPos square(Real x) { ... }`;
- member access and indexing, `x[,1]`, `moves[mi++]`;
- `|>` pipes (`Q |> fnGammaASRV(alpha, 4)`);
- multi-line binary expressions (string `+` continuations).

### 2.2 Names and functions (RB2xxx)

| Code | Default level | Meaning |
| --- | --- | --- |
| RB2101 | warning (`strict`: error) | Unknown RevBayes function; includes the nearest known name and a replacement fix |
| RB2102 | error | A constant is called as a function |
| RB2103 | warning | Variable is not defined in this script; skipped when the script calls `source()` (it may come from the sourced file) |

### 2.3 Signatures and arguments (RB3xxx)

| Code | Default level | Meaning |
| --- | --- | --- |
| RB3101 | error | Duplicate named argument |
| RB3102 | error (high confidence) / warning | Unknown parameter name; fixed mappings such as `generation→generations` are errors, other unknown names on loose/legacy signatures are mostly warnings |
| RB3103 | error (warning when loose) | No matching overload / missing or too many arguments |
| RB3202 | error (warning when loose and no near-neighbor suggestion) | Invalid enumeration value; includes the nearest legal value |
| RB3203–RB3210 | error/warning | Numeric/boolean/string type and range checks (integers, non-negative values, probabilities ≤ 1, unquoted `TRUE`/`FALSE`, and so on) |

Signature matching rules:

1. Fill slots by named argument first, then fill remaining slots positionally;
2. all required parameters must be filled;
3. variadic signatures (`...`) skip arity/literal checks and only verify that named arguments exist;
4. `readTrees(file, text, ...)` accepts either alternative;
5. when a normal match fails, a positional match that prioritizes required parameters is attempted (help pages sometimes list optional parameters before required ones);
6. alias calls (such as `treeAssembly`) are automatically treated as loose;
7. help entries listed in `LOOSE_SIGNATURE_NAMES` (incomplete help) downgrade signature problems to warnings — `strict` still makes them errors.

### 2.4 Semantics (RB4xxx)

| Code | Level | Check |
| --- | --- | --- |
| RB4101 | warning | An `mcmc()` was constructed without any moves |
| RB4102 | warning | `dnPhyloCTMC` was used without `.clamp(data)` |
| RB4103 | info | Monitors were declared but never appended |
| RB4104 | info | An `mcmc()` was constructed but never `.run()` |
| RB4105 | warning + review fix | Positional order of `mcmc(model, moves, monitors)` differs from the help signature; suggests named arguments |
| RB4106 | error | `mcmc.run(generations=0)` or a negative count |
| RB4107 | warning | Multiple monitors write to the same file |
| RB4108 | warning | A file referenced by `read*`/`source` does not exist (when `check_files` is on and a base directory is known) |

### 2.5 Service and pack lifecycle (RB4001–RB4007)

| Code | Level | Check |
| --- | --- | --- |
| RB4001 | error | Pack manifest syntax/uniqueness/dependency DAG invalid (`registerPack`) |
| RB4002 | error | `generateByPack` named a pack that is not installed |
| RB4003 | error | Pack is installed but not enabled |
| RB4004 | error | The pack has no analysis with the given id |
| RB4005 | error | The analysis's cross-pack `requires` is not installed/enabled |
| RB4007 | error | A recipe dependency pack is not enabled |

Pack tool write errors use the pack prefix plus `58xx` (for example `FBD5802` refuses an overwrite), with diagnostic `source` set to `pack:<id>`.

### 2.6 Pack diagnostic namespaces

| Pack | Prefix | `source` |
| --- | --- | --- |
| fbd | `FBD` | `pack:fbd` |
| dating | `DAT` | `pack:dating` |
| coalescent-demography | `COA` | `pack:coalescent-demography` |
| diversification | `DIV` | `pack:diversification` |
| continuous-traits | `TRA` | `pack:continuous-traits` |
| biogeo | `BIO` | `pack:biogeo` |
| morphology-advanced | `MOR` | `pack:morphology-advanced` |
| chromosome | `CHR` | `pack:chromosome` |
| molecular-selection | `MOL` | `pack:molecular-selection` |
| host-repertoire | `HOS` | `pack:host-repertoire` |
| pps | `PPS` | `pack:pps` |
| model-selection | `SEL` | `pack:model-selection` |
| ted | `TED` | `pack:ted` |

Pack generation output is re-validated strictly by core; packs never reuse core's `RB` codes for their own diagnostics.

## 3. Generator diagnostics (RB5xxx)

| Code | Meaning |
| --- | --- |
| RB5000–RB5033 | Spec is not an object, invalid analysis/data/type/state_count, invalid model parameters, invalid array lengths or sums-to-1, invalid tree/branch-length/prior combinations, invalid MCMC parameters, no free parameters |
| RB5101–RB5104 | Non-fatal warnings: outgroup ignored for a fixed tree, `nruns > 4`, `sample_every > generations`, name sanitized |
| RB5800–RB5803 | Tool layer: write outside workspace refused, overwrite refused, output directory outside workspace or failed to create, file write failed |

RB5033 is an important correctness check: a fixed tree with fixed branch lengths and a fully fixed substitution/rate model would produce an MCMC without any moves. The plugin refuses such a spec outright instead of emitting a script that cannot sample.

## 4. Runtime diagnostics (RB6xxx)

RevBayes error text usually carries no script line numbers. The plugin therefore:

- uses `buildCallLineIndex()` to map function/method names in the error back to the first call site line in the script;
- parses `Error:`, `Missing Variable:`, `Provided call` / `Correct usage`, and `Potentially matching functions` blocks;
- keeps one diagnostic per underlying error so dozens of `lnProb = inf` lines never flood the output (capped by the configured `maxDiagnostics`).

| Code | Typical message | Advice |
| --- | --- | --- |
| RB6001 | `No overloaded function 'x' matches...` / `No function named 'x'` / `Unknown function 'x'` | Check the signature or nearest function name; prefer `revbayes_lookup` |
| RB6002 | `Argument or label mismatch for function call` | Fix argument names/order/count per `Correct usage` |
| RB6003 | `Missing Variable: Variable x does not exist` | Define or read the variable earlier, or fix the spelling |
| RB6004 | `Could not open...` / `Could not parse ... as a number` | Absolute paths / working directory; fix the data file |
| RB6005 | `Index 0 not allowed...` / index type errors | RevBayes subscripts start at 1 |
| RB6006 | `SSE model has 2 states, but observed data set has 4 states` | Match state count to the data (e.g. `fnJC(4)`) |
| RB6007 | `Cannot complete this assignment ... circular dependency` | Break the dependency; define constants first |
| RB6008 | `Could not compute lnProb ... = inf` | Check prior support and initial values |
| RB6009 | `Newick error at line/column` | Fix the tree file |
| RB6010 | `Warning:` | Kept as a warning; does not affect `ok` |
| RB6996 | Canceled by the caller | Retry when idle |
| RB6997 | Killed by a signal | Check memory / crashes |
| RB6998 | Timeout | Increase the timeout, reduce smoke generations, check for hangs |
| RB6999 | Non-zero exit without a recognizable message | Inspect the stdout/stderr summary |

`Problem processing line N in file "..."` is not a separate error: the plugin attaches it as location context to the previous diagnostic (this is what RevBayes 1.4.1 actually prints), avoiding duplicate reports.

Runtime skips are reported as RB5900–RB5905 (runtime disabled, static errors present, binary not found, invalid options, or a `run` nested inside a block/function that cannot be safely rewritten). Skips are never misreported as script errors. In the RB5905 case RevBayes is not started at all, so a full MCMC is never accidentally executed as a "dry-run".

## 5. Auto-fix policy

With `apply_fixes: true`, only fixes with `fix.safety === 'safe'` are applied:

- unknown function → nearest known function name (edit distance ≤ 2);
- enumeration value → nearest legal value;
- unknown parameter → nearest parameter name (high confidence);
- `TRUE`/`FALSE` written as strings → quotes removed;
- fixed mappings such as `generation` → `generations`.

Fixes with `safety: 'review'` (for example rewriting `mcmc(model, moves, monitors)` into named arguments) are applied only with `allow_risky_fixes: true`. Fixes are applied back-to-front by range; overlapping fixes are skipped. The script is re-validated after fixing and returned as `fixed_script`.

## 6. Strict mode semantics

By default (`strict: false`), **unknown functions** and **distant unknown parameters on loose signatures** are warnings, because:

- the RevBayes help catalog is a snapshot and can lag behind upstream source or the plugin;
- tutorial and project scripts may use older parameter names (such as `dnFBDP(origin=..., psi=...)`).

With `strict: true` both become errors. High-confidence problems (`mcmc.run(generation=...)`, invalid enumerations, unambiguous arity/required-parameter errors) are errors in both modes.

## 7. Known false positives / negatives

- The undefined-variable check is skipped when the script calls `source()`; scripts that rely on interactive-session variables without sourcing may produce warnings.
- Member methods with no help data (some object methods) are skipped rather than reported as unknown methods.
- Taxa count/name consistency for fixed trees is not compared statically; confirm with a dry-run or manually.
- Runtime line numbers are approximations recovered by function-name lookup; RevBayes itself does not print exact script lines.
- Execution covers only the first top-level `run`; multi-stage scripts validate only the first stage's setup/smoke.
- The remaining 6 corpus errors (see [verification.md](verification.md)) are tutorial prose fragments (such as `Example code to come soon...`) or scripts that are themselves missing a closing parenthesis — none are validator regressions.

## 8. Corpus regression

The static validator is regression-tested against the full official tutorial corpus:

```sh
npm run corpus
```

`scripts/validate-corpus.mjs` walks the reference checkout, statically validates every `.Rev` file with the bundled catalog (544 reference scripts), and allows only the 6 documented exceptions (538 clean files) to fail. Any new error anywhere in the corpus fails the gate, so validator changes cannot silently change results on real tutorials. The exception list lives in the script; see [verification.md](verification.md) for details and the coverage gate in [coverage.md](coverage.md).
