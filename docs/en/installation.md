# Installation

RevBayes Forge ships as a single DSH plugin, `dsh-revbayes-forge`. All 13 model packs are built into the core bundle, so installing, upgrading, and removing the plugin only ever involves one bundle entry; which packs are active is controlled afterwards through configuration or the settings page (see [configuration.md](configuration.md) and [settings-ui.md](settings-ui.md)).

## 1. Requirements

| Component | Version | Notes |
| --- | --- | --- |
| DeepSeek Harness (DSH) | >= 0.2.1-rc.2 | The host application. It provides the tool registry, the web carrier for the settings routes, and the single `@deepseek-ai/dsh-tools` peer instance. |
| Node.js | >= 20 | Needed to install and check out the monorepo. |
| RevBayes (`rb`) | 1.4.1 | Optional. Generation and static validation work without a binary; dry-run and smoke validation require a real `rb` executable. |

`@deepseek-ai/dsh-tools` is declared as a **peerDependency** of the plugin (a devDependency only for local development) and is supplied by the DSH host as a single instance. Do not install a separate copy into the profile — if the host and the plugin each hold their own scheduler symbol, every tool call fails with `undefined (reading 'prepare')`.

## 2. Installation

From the repository root:

```sh
npm install

# Install the core plugin only (all 13 model packs are built in)
dsh plugin --profile desktop add file:"$PWD/packages/core"
```

Then **fully quit and restart DeepSeek Harness** so the profile reloads with the new bundle. There is nothing else to install: the 13 model packs are internal modules of `dsh-revbayes-forge` (`packages/core/src/packs/builtin/`), and no per-pack bundles exist. The `packages/pack-*` directories in the repository are development fixture packages only and must never be added to a profile.

## 3. Verify the install

After restarting, dump the profile and confirm exactly one RevBayes Forge bundle is mounted:

```sh
dsh --profile desktop --dump-config | grep -A3 revbayes-forge
```

The dump must contain a single `- id: dsh-revbayes-forge` row and no `dsh-revbayes-forge-pack-*` rows. Once DSH is running, `revbayes_environment` reports the binary, catalog size, pack states, and active tools; the settings page Overview tab shows the same information.

For an isolated, automated check, the install gate mounts the core bundle into a throwaway `DSH_HOME` and asserts the same invariants (exactly one bundle row, no pack bundles, client entry point and patch file present, no bundled `dsh-tools` copy):

```sh
npm run verify:dsh
```

If the `dsh` CLI is not on `PATH`, the script reports `SKIP` and exits 0; see [verification.md](verification.md) for the CLI resolution order (`DSH_JS` → `DSH_BIN` → `PATH`, or `DSH_NPX=1`).

## 4. State and persistence

The settings page persists its pack selection in a dedicated state file:

| Item | Value |
| --- | --- |
| Location | `$DSH_HOME/revbayes-forge/state.json` (overridable with the `stateFile` config key) |
| Content | `{ version: 1, enabledPacks: [...], packConfig: {...}, updatedAt }` |
| Write mode | Atomic: write to a temp file, then `rename` over the target, so a crash cannot leave a half-written file |
| Corruption handling | A missing, malformed, or invalid file is ignored with a log warning; the plugin still starts with defaults |

On startup the plugin reads this file. When a valid state file exists, its `enabledPacks` and `packConfig` take precedence over the profile defaults, so a selection made on the settings page survives a restart without reconfiguration. The state file is written only by the plugin's own reconfigure path; the profile's `cordis.patch.yml` is never rewritten. Plugin-level configuration (`revbayesBinary`, timeouts, workspace, catalog path, and so on) continues to come from the profile and is applied on restart — see [configuration.md](configuration.md).

Generated scripts and their outputs are written into the calling session's workspace under the write guard described in [tool-reference.md](tool-reference.md); the state file is the only file the plugin writes outside a workspace.

## 5. Uninstall

1. Remove the plugin from the profile with the same DSH CLI plugin interface used to install it (or delete the `dsh-revbayes-forge` bundle row from the profile), then **fully quit and restart DeepSeek Harness**. The DSH plugin list must show no RevBayes Forge entry afterwards.
2. Optionally delete `$DSH_HOME/revbayes-forge/state.json` to discard the persisted pack selection. The directory is recreated if the plugin is reinstalled.
3. Generated scripts, diagnostics, and any `output_path` artifacts written into your workspaces are ordinary user files and are not removed by the plugin; clean them up like any other project output.

The plugin does not install background services, modify files outside its state file, temp directories, and permitted workspace outputs, or change the profile YAML on its own.
