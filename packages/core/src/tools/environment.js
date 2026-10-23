/** `revbayes_environment` tool: report binary, config, and catalog readiness. */
import { checkEnvironment } from '../rev/runtime.js'
import { resolveUserPath, sessionCwd } from '../paths.js'
import { codeFence } from './shared.js'

function outputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ready_for_runtime: { type: 'boolean', required: true },
      revbayes: {
        type: 'object', additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          binary: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          version: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          source: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          checked: { type: 'array', items: { type: 'string' } },
        },
      },
      catalog: {
        type: 'object', additionalProperties: false,
        properties: {
          entries: { type: 'number', required: true },
          signatures: { type: 'number', required: true },
          methods: { type: 'number', required: true },
        },
      },
      config: {
        type: 'object', additionalProperties: false,
        properties: {
          allow_runtime: { type: 'boolean', required: true },
          default_mode: { type: 'string', required: true },
          default_runtime_mode: { type: 'string', required: true },
          timeout_ms: { type: 'number', required: true },
          max_run_generations: { type: 'number', required: true },
          workspace: { type: 'string', required: true },
          temp_root: { type: 'string', required: true },
          enabled_packs: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], required: true },
        },
      },
      packs: {
        type: 'array',
        required: true,
        items: {
          type: 'object', additionalProperties: true,
          properties: {
            id: { type: 'string', required: true },
            version: { type: 'string', required: true },
            maturity: { type: 'string', required: true },
            enabled: { type: 'boolean', required: true },
            blocked: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            analyses: { type: 'array', items: { type: 'object', additionalProperties: true } },
            tools: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      tools: { type: 'array', items: { type: 'string' }, required: true },
      configured_missing: { type: 'array', items: { type: 'string' }, required: true },
      uncovered_families: { type: 'array', items: { type: 'string' }, required: true },
      install_hint: { type: 'string' },
    },
  }
}

function renderReport(value) {
  const lines = [
    value.ready_for_runtime ? 'Runtime validation is available.' : 'Runtime validation is NOT available (static validation still works).',
    '',
    `RevBayes: ${value.revbayes.found ? `${value.revbayes.binary} (${value.revbayes.version ?? 'version unknown'})` : 'not found'}`,
    `Catalog: ${value.catalog.entries} entries, ${value.catalog.signatures} signatures, ${value.catalog.methods} methods`,
    `Config: mode=${value.config.default_mode}/${value.config.default_runtime_mode}, timeout=${value.config.timeout_ms}ms, smoke generations=${value.config.max_run_generations}, runtime=${value.config.allow_runtime ? 'enabled' : 'disabled'}`,
    `Workspace: ${value.config.workspace}`,
  ]
  if (!value.revbayes.found) {
    lines.push('', 'Checked:', codeFence(value.revbayes.checked.join('\n') || '(none)', 'text'))
    if (value.install_hint) lines.push('', value.install_hint)
  }
  lines.push('', 'Installed packs:')
  if (value.packs.length === 0) {
    lines.push('  (none — install a pack such as dsh-revbayes-forge-pack-fbd)')
  } else {
    for (const pack of value.packs) {
      const status = pack.blocked !== null ? `blocked: ${pack.blocked}` : pack.enabled ? 'enabled' : 'disabled'
      lines.push(`  ${pack.id.padEnd(30)} ${pack.version.padEnd(7)} ${pack.maturity.padEnd(12)} ${status}`)
    }
  }
  lines.push('', `Tools: ${value.tools.length > 0 ? value.tools.join(', ') : '(core only)'}`)
  if (value.config.enabled_packs === 'all') {
    lines.push(`Note: enabledPacks=all exposes ${value.tools.length} pack tool(s), including experimental packs.`)
  }
  if (value.configured_missing.length > 0) {
    lines.push(`Configured but not installed: ${value.configured_missing.join(', ')}`)
  }
  lines.push(`Uncovered families: ${value.uncovered_families.length === 0 ? '(none)' : value.uncovered_families.join(', ')}`)
  return lines.join('\n')
}

/** Build the environment tool definition. */
export function createEnvironmentTool(services) {
  return {
    name: 'revbayes_environment',
    description:
      'Report whether the RevBayes executable (rb) is available for dry-run/smoke validation, which binary and '
      + 'version were found, the bundled help-catalog size, and the effective plugin configuration. Call this '
      + 'when validation says runtime checks are unavailable, or before choosing a validation mode.',
    parameters: {
      binary: { type: 'string', description: 'Optional RevBayes executable path to probe instead of the configured/PATH lookup.' },
    },
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const workspace = sessionCwd(exec)
      let binary = services.config.revbayesBinary
      if (typeof args.binary === 'string' && args.binary.trim().length > 0) {
        binary = /^[A-Za-z]:[\\/]/.test(args.binary) || args.binary.startsWith('/')
          ? args.binary
          : resolveUserPath(args.binary, workspace)
      }
      const env = checkEnvironment({
        binary,
        timeoutMs: services.config.timeoutMs,
        maxRunGenerations: services.config.maxRunGenerations,
        tempRoot: services.config.tempRoot,
        allowRuntime: services.config.allowRuntime,
      })
      const packs = services.forge?.listPacks?.() ?? []
      const installedIds = new Set(packs.map((pack) => pack.id))
      const configured = Array.isArray(services.config.enabledPacks) ? services.config.enabledPacks : []
      const configuredMissing = configured.filter((id) => !installedIds.has(id))
      const coverage = services.forge?.reportCoverage?.() ?? { unprotectedFamilies: [] }
      const packTools = packs.filter((pack) => pack.enabled).flatMap((pack) => pack.tools)
      return {
        ready_for_runtime: env.found && services.config.allowRuntime,
        revbayes: {
          found: env.found,
          binary: env.binary,
          version: env.version,
          source: env.source,
          checked: env.checked,
        },
        catalog: {
          entries: services.catalog.meta.entries ?? Object.keys(services.catalog.entries).length,
          signatures: services.catalog.meta.signatures ?? 0,
          methods: services.catalog.meta.methods ?? 0,
        },
        config: {
          allow_runtime: services.config.allowRuntime,
          default_mode: services.config.defaultMode,
          default_runtime_mode: services.config.defaultRuntimeMode,
          timeout_ms: services.config.timeoutMs,
          max_run_generations: services.config.maxRunGenerations,
          workspace,
          temp_root: services.config.tempRoot,
          enabled_packs: services.config.enabledPacks,
        },
        packs,
        tools: packTools,
        configured_missing: configuredMissing,
        uncovered_families: coverage.unprotectedFamilies ?? [],
        ...(env.found ? {} : { install_hint: 'Install RevBayes so that `rb` is on PATH, then set revbayesBinary in the plugin config if it lives elsewhere. Static validation does not require RevBayes.' }),
      }
    },
  }
}
