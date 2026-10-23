# Configuration

All plugin configuration lives in the profile's `cordis.patch.yml`, keyed by plugin id; restart or reload DSH after changing it. The settings page manages pack selection at runtime (persisted to the state file, see [installation.md](installation.md)), but the keys below are the static baseline the plugin loads at startup.

```yaml
- id: revbayes-forge
  name: dsh-revbayes-forge
  config:
    revbayesBinary: /usr/local/bin/rb
    allowRuntime: true
    defaultMode: auto
    defaultRuntimeMode: dry
    timeoutMs: 120000
    maxRunGenerations: 100
    keepTemp: false
    strict: false
    checkFiles: true
    maxDiagnostics: 50
    maxScriptBytes: 1048576
    allowWriteOutsideWorkspace: false
    enabledPacks: default
    packConfig:
      fbd:
        strictTaxonomy: true
```

## 1. Runtime fields

| Field | Default | Meaning |
| --- | --- | --- |
| `revbayesBinary` | `""` | Path to `rb`. When empty, the plugin searches `REVBAYES_BIN` → `REVBAYES` → `RB_BIN` → `PATH` → common install locations. |
| `allowRuntime` | `true` | Whether dry/smoke execution of RevBayes is allowed at all. |
| `defaultMode` | `auto` | Default validation mode: `auto` / `static` / `dry` / `smoke`. |
| `defaultRuntimeMode` | `dry` | The runtime mode actually executed when `defaultMode` (or a call) is `auto`. |
| `timeoutMs` | `120000` | Subprocess timeout in milliseconds (1000–1800000). |
| `maxRunGenerations` | `100` | Cap on MCMC generations for smoke runs (1–100000). |
| `keepTemp` | `false` | Keep runtime temporary directories after a run (for debugging). |
| `tempRoot` | OS temp | Root directory for runtime temp files. |
| `catalogPath` | `""` | External signature catalog JSON; empty uses the bundled catalog. Must be absolute when set. |
| `strict` | `false` | Promote unknown functions and unknown loose-signature parameters from warning to error (see [validation-rules.md](validation-rules.md)). |
| `checkFiles` | `true` | Check that data/tree files referenced by a script exist during static validation. |
| `maxDiagnostics` | `50` | Maximum diagnostics returned per call (1–500). |
| `maxScriptBytes` | `1048576` | Size cap for scripts accepted by validation (1024–10485760). |
| `allowWriteOutsideWorkspace` | `false` | Allow `output_path` targets outside the calling session's workspace. |

Two additional keys exist for advanced deployments: `workspace` (override the workspace root used for relative paths; default is the calling session's working directory) and `stateFile` (override the settings-page state file location; default `$DSH_HOME/revbayes-forge/state.json`).

## 2. Pack fields

| Field | Default | Behavior |
| --- | --- | --- |
| `enabledPacks` | `default` | `default`: every installed pack with `verified` maturity; `all`: every installed pack, including `experimental`; `none`: core tools only; array of pack ids: exactly the listed packs. |
| `packConfig` | `{}` | Read-only per-pack configuration, keyed by pack id; each pack interprets its own fields. |

Semantics and edge cases:

- Naming an uninstalled pack in `enabledPacks` or `packConfig` is not an error; `revbayes_environment` reports it under `configured_missing`.
- Disabled packs still register their manifests, so `revbayes_environment` and the settings page can show installed-but-disabled and blocked states.
- Pack tools are registered only when a pack is enabled. Disabling a pack never removes validation: `revbayes_validate` still checks hand-written scripts of that family against the shared catalog.
- A pack whose dependencies are not enabled stays `blocked` and registers no tools; nothing is half-registered (see [architecture.md](architecture.md)).
- The profile `enabledPacks` value is the baseline. If the settings-page state file exists, its selection overrides `enabledPacks`/`packConfig` at startup; with no state file, the YAML applies as-is.

## 3. Paths and writes

- Relative paths are resolved against the calling session's workspace.
- Writes outside the workspace are refused by default (`RB58xx`, or the pack prefix plus `58xx`); set `allowWriteOutsideWorkspace: true` to permit them.
- For normal packs, `output_path` is a file path. Workflow packs (pps, ted) produce multiple artifacts: there `output_path` is a directory, and file names come from each artifact's `name`, reduced to a basename to prevent path escape.
- An existing output file is never overwritten silently: pass `overwrite: true`. The plugin never deletes user files (`.Rev` scripts or outputs).
