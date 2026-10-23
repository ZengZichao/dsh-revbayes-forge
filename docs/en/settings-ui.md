# Settings UI and HTTP API

The RevBayes Forge settings page ships inside the plugin (`lib/client.js`) and registers itself in DSH's `settings.section` slot (id `revbayes-forge`, order 20). The host half (`src/host/routes.js`) mounts exact routes under `/plugins/dsh-revbayes-forge/`, and every route reuses the same forge service, pack tools, static validation, and workspace write guard as the model-facing tools — the UI is pure user reference over the plugin, adding no shell execution and no relaxed validation.

## 1. Tabs

| Tab | Contents |
| --- | --- |
| Overview | Core status, RevBayes binary path/version/source, catalog size (611 entries / 654 signatures / 451 methods), enabled pack count, active tool count, uncovered analysis families, state file location and presence |
| Packs | All 13 packs with maturity badges (verified/golden/experimental), enable switches, analysis lists (including per-analysis blocked reasons), tool names, and dependency notes (ted → fbd + dating; timefig_dating → biogeo; pps / model-selection base_spec usage). "Save and apply" registers/unregisters the affected tools immediately and persists the selection |
| Environment | `rb` path/version/source, `allowRuntime`, timeout, smoke generation cap, workspace, catalog path, state file path, and a "Detect RevBayes" button that accepts candidate paths |
| Generate | Pick a pack and analysis, paste or auto-fill an example JSON spec; runs the pack generator with strict validation and the standard workspace write guard; shows a script preview, diagnostics, and warnings; optional write into the workspace |
| Validate | Script text or path, static/dry/smoke modes, strict-mode and safe-fix toggles; shows static and runtime results with diagnostics |

The Packs tab is the only place pack selection is changed at runtime. Everything under Environment reflects the profile `config` — those values are still edited in the profile's `cordis.patch.yml` and applied on restart; the page states this explicitly and never silently rewrites YAML.

## 2. Host HTTP API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/plugins/dsh-revbayes-forge/state` | GET | Overview document: core/environment/catalog/packs/counts/tools/state-file information |
| `/plugins/dsh-revbayes-forge/packs` | POST | `{ enabledPacks, packConfig }` → hot reconfigure + persist; returns the new state and the blocked list |
| `/plugins/dsh-revbayes-forge/generate` | POST | `{ pack, analysis, spec, outputPath?, overwrite? }` → runs the pack tool: generate + strict validation + optional workspace-guarded write |
| `/plugins/dsh-revbayes-forge/validate` | POST | `{ script?/path?, mode, strict?, applyFixes?, allowRiskyFixes?, checkFiles? }` → same pipeline as `revbayes_validate` |
| `/plugins/dsh-revbayes-forge/tool-schema` | GET | Current schemas of the 4 core tools plus every enabled pack tool |
| `/plugins/dsh-revbayes-forge/detect` | POST | Probe for RevBayes, optionally with a candidate binary path |

All routes are registered as exact matches on the DSH web carrier. If no web carrier is available the routes are skipped with a warning; the four model tools keep working regardless.

## 3. Persistence semantics

- State file: `$DSH_HOME/revbayes-forge/state.json` (overridable with the `stateFile` config key).
- Writes are atomic: a temp file is written, then `rename` replaces the target, so a crash cannot leave a half-written file.
- Content: `{ version: 1, enabledPacks: [...], packConfig: {...}, updatedAt }`. Invalid or corrupt files are ignored with a log warning and never prevent plugin startup.
- After "Save and apply" the affected tools are registered/unregistered immediately in the same process (`forge.reconfigure`) — no DSH restart is needed. After restarting DSH, the plugin reads the same state file, so the selection persists without reconfiguration.
- The profile's `cordis.patch.yml` is never modified. On startup, a valid state file's `enabledPacks`/`packConfig` override the profile defaults; with no state file the YAML applies as-is. See [configuration.md](configuration.md) and [installation.md](installation.md).

## 4. Security model

- Request bodies are capped at 2 MB; larger or non-JSON bodies fail with a structured error.
- No shell is executed. Dry/smoke runs spawn only the configured RevBayes binary; nothing else is ever exec'd.
- Static validation is never bypassed: `/generate` runs the same strict re-validation as pack tools, and `/validate` is the same pipeline as `revbayes_validate`.
- Output paths go through `assertWriteAllowed`: writes outside the workspace are refused unless `allowWriteOutsideWorkspace` is configured, existing files require `overwrite`, and workflow output directories must not contain `..`.
- Errors are uniform and structured: `{ ok: false, error: { code, message, path? } }`. Known plugin errors return their code with HTTP 400/404/409; unexpected internal exceptions are logged server-side and returned as a generic `RB5000` without stack traces.
- Responses disable caching (`cache-control: no-store`, `nosniff`).
