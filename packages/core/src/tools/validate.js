/** `revbayes_validate` tool: static + optional execution-time validation. */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { applyFixes, validateScript } from '../rev/static-validator.js'
import { findRevBayes, runRevBayes } from '../rev/runtime.js'
import { resolveRuntimeOverrides } from '../config.js'
import { fileInfo, resolveUserPath, sessionCwd } from '../paths.js'
import {
  DIAGNOSTIC_OUTPUT,
  codeFence,
  formatDiagnostics,
  mergeDiagnostics,
  summarizeDiagnostics,
} from './shared.js'

function inputSchema() {
  return {
    script: { type: 'string', description: 'RevBayes script text to validate. Provide exactly one of script or path.' },
    path: { type: 'string', description: 'Path to a .Rev file to validate. Relative paths resolve against the session workspace.' },
    mode: {
      type: 'string',
      enum: ['auto', 'static', 'dry', 'smoke'],
      description: 'auto = static checks plus a dry run when RevBayes is available; static = no execution; dry = setup-only run; smoke = capped short MCMC run. Default from plugin config (auto).',
    },
    strict: { type: 'boolean', description: 'Promote conservative findings (unknown functions, legacy signatures) to errors.' },
    apply_fixes: { type: 'boolean', description: 'Apply safe auto-fixes (typos, enum values) and re-validate the result.' },
    allow_risky_fixes: { type: 'boolean', description: 'Also apply fixes marked "needs review" (for example positional MCMC argument order).' },
    check_files: { type: 'boolean', description: 'Warn when referenced input files do not exist. Default true when a path is given.' },
    binary: { type: 'string', description: 'RevBayes executable override for this call.' },
    workdir: { type: 'string', description: 'Working directory for relative input files and the RevBayes process. Defaults to the script directory.' },
    timeout_ms: { type: 'number', description: 'Wall-clock timeout for the RevBayes process (1000-1800000).' },
    max_generations: { type: 'number', description: 'Generation cap for smoke mode (default from plugin config, 100).' },
    keep_temp: { type: 'boolean', description: 'Keep the temporary directory containing the transformed script and redirected outputs.' },
    max_diagnostics: { type: 'number', description: 'Maximum diagnostics returned (default 50).' },
  }
}

function outputSchema() {
  const runtime = {
    type: 'object',
    additionalProperties: false,
    properties: {
      requested: { type: 'boolean', required: true },
      attempted: { type: 'boolean', required: true },
      ok: { type: 'boolean', required: true },
      mode: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      binary: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      binary_version: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      exit_code: { oneOf: [{ type: 'number' }, { type: 'null' }] },
      timed_out: { type: 'boolean' },
      duration_ms: { oneOf: [{ type: 'number' }, { type: 'null' }] },
      skipped_reason: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      notes: { type: 'array', items: { type: 'string' } },
      temp_dir: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      stdout_excerpt: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      diagnostics: { type: 'array', items: DIAGNOSTIC_OUTPUT },
    },
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      target: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          source: { type: 'string', required: true, enum: ['file', 'text'] },
          lines: { type: 'number', required: true },
          bytes: { type: 'number', required: true },
          base_dir: { type: 'string', required: true },
        },
      },
      static: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          summary: {
            type: 'object', additionalProperties: false,
            properties: {
              error: { type: 'number', required: true },
              warning: { type: 'number', required: true },
              info: { type: 'number', required: true },
            },
          },
          stats: { type: 'object', additionalProperties: true },
          diagnostics: { type: 'array', items: DIAGNOSTIC_OUTPUT },
        },
      },
      runtime: runtime,
      diagnostics: { type: 'array', items: DIAGNOSTIC_OUTPUT },
      summary: {
        type: 'object', additionalProperties: false,
        properties: {
          error: { type: 'number', required: true },
          warning: { type: 'number', required: true },
          info: { type: 'number', required: true },
        },
      },
      fixed_script: { type: 'string' },
      fixes: {
        type: 'object', additionalProperties: false,
        properties: {
          applied: { type: 'array', items: { type: 'object', additionalProperties: true } },
          skipped: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
    },
  }
}

function skippedRuntime(reason, mode, diagnostics) {
  return {
    requested: true,
    attempted: false,
    ok: false,
    mode: mode === 'static' ? null : mode === 'smoke' ? 'smoke' : 'dry',
    binary: null,
    binary_version: null,
    exit_code: null,
    timed_out: false,
    duration_ms: null,
    skipped_reason: reason,
    notes: [],
    temp_dir: null,
    stdout_excerpt: null,
    diagnostics,
  }
}

function renderReport(value) {
  const lines = []
  const target = value.target.path ?? 'inline script'
  lines.push(`${value.ok ? 'Validation passed' : 'Validation failed'}: ${target} (${value.target.lines} lines, ${value.target.bytes} bytes).`)
  lines.push(`Static: ${value.static.summary.error} error(s), ${value.static.summary.warning} warning(s), ${value.static.summary.info} info.`)
  if (value.runtime.requested) {
    if (value.runtime.attempted) {
      lines.push(`Runtime: ${value.runtime.mode} run ${value.runtime.ok ? 'passed' : 'failed'}${value.runtime.exit_code !== null ? ` (exit ${value.runtime.exit_code})` : ''} in ${value.runtime.duration_ms ?? '?'} ms.`)
    } else {
      lines.push(`Runtime: not attempted — ${value.runtime.skipped_reason ?? 'unavailable'}.`)
    }
  }
  const diagnostics = value.diagnostics.filter((d) => d.severity !== 'info' || value.runtime.attempted === false)
  if (diagnostics.length > 0) {
    lines.push('', 'Diagnostics:', formatDiagnostics(diagnostics, value.diagnostics.length))
  }
  if (value.fixes !== undefined && value.fixes.applied.length > 0) {
    lines.push('', `Applied ${value.fixes.applied.length} fix(es):`)
    for (const fix of value.fixes.applied) lines.push(`- ${fix.code ?? ''} ${fix.description ?? `${fix.kind} ${fix.start}-${fix.end}`}`.trim())
    if (value.fixes.skipped.length > 0) lines.push(`Skipped ${value.fixes.skipped.length} fix(es) needing review or overlapping another fix.`)
  }
  if (value.runtime.stdout_excerpt !== null && !value.runtime.ok && value.runtime.attempted) {
    lines.push('', 'RevBayes output:', codeFence(value.runtime.stdout_excerpt, 'text'))
  }
  if (value.fixed_script !== undefined) {
    lines.push('', 'Fixed script:', codeFence(value.fixed_script, 'rev'))
  }
  return lines.join('\n')
}

/**
 * Build the validate tool definition.
 * @param {{config: object, catalog: object}} services
 */
export function createValidateTool(services) {
  return {
    name: 'revbayes_validate',
    description:
      'Validate a RevBayes script in layers: lexical/structure, function signatures and argument names against '
      + 'the bundled RevBayes help catalog, MCMC wiring, file references, then optional execution-time checks. '
      + 'mode="dry" loads data and builds the model/moves/monitors/MCMC object without sampling; mode="smoke" '
      + 'runs a short capped MCMC. Failures come back with line numbers, explanations, and suggested fixes. '
      + 'Use this before launching any generated or edited analysis.',
    parameters: inputSchema(),
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const workspace = sessionCwd(exec)
      const hasScript = typeof args.script === 'string' && args.script.trim().length > 0
      const hasPath = typeof args.path === 'string' && args.path.trim().length > 0
      if (hasScript === hasPath) {
        throw new Error('provide exactly one of script or path')
      }
      let source = args.script
      let targetPath = null
      let baseDir = workspace
      if (hasPath) {
        targetPath = resolveUserPath(args.path, workspace)
        const info = fileInfo(targetPath)
        if (!info.exists) throw new Error(`script file not found: ${targetPath}`)
        if (!info.isFile) throw new Error(`not a file: ${targetPath}`)
        if (info.size > services.config.maxScriptBytes) {
          throw new Error(`script is larger than maxScriptBytes (${services.config.maxScriptBytes}): ${info.size} bytes`)
        }
        source = readFileSync(targetPath, 'utf8')
        if (source.includes('\u0000')) throw new Error('script contains NUL bytes; refusing to parse a binary file')
        baseDir = dirname(targetPath)
      }
      if (typeof args.workdir === 'string' && args.workdir.trim().length > 0) {
        baseDir = resolveUserPath(args.workdir, workspace)
        const info = fileInfo(baseDir)
        if (!info.exists || !info.isDirectory) throw new Error(`workdir is not a directory: ${baseDir}`)
      }
      const strict = args.strict === undefined ? services.config.strict : args.strict
      const checkFiles = args.check_files === undefined ? services.config.checkFiles : args.check_files
      const maxDiagnostics = Math.max(1, Math.min(args.max_diagnostics ?? services.config.maxDiagnostics, 500))
      const mode = args.mode ?? services.config.defaultMode

      let currentSource = source
      let staticResult = validateScript(currentSource, {
        catalog: services.catalog,
        sourcePath: targetPath,
        baseDir,
        checkFiles,
        strict,
      })
      let fixes = undefined
      if (args.apply_fixes === true) {
        const fixed = applyFixes(currentSource, staticResult.diagnostics, { risky: args.allow_risky_fixes === true })
        fixes = { applied: fixed.applied, skipped: fixed.skipped }
        if (fixed.applied.length > 0) {
          currentSource = fixed.script
          staticResult = validateScript(currentSource, {
            catalog: services.catalog,
            sourcePath: targetPath,
            baseDir,
            checkFiles,
            strict,
          })
        }
      }

      const runtimeDiagnostics = []
      let runtime = skippedRuntime('mode is static', mode, runtimeDiagnostics)
      const runtimeRequested = mode !== 'static'
      if (runtimeRequested) {
        runtime.requested = true
        if (services.config.allowRuntime !== true) {
          runtimeDiagnostics.push({
            severity: 'info', code: 'RB5900', message: 'Runtime validation is disabled in the plugin configuration.',
            source: 'runtime', suggestion: 'Set allowRuntime=true to enable dry/smoke runs.',
          })
          runtime = skippedRuntime('runtime disabled by config', mode, runtimeDiagnostics)
        } else if (!staticResult.ok) {
          runtimeDiagnostics.push({
            severity: 'info', code: 'RB5901', message: 'Runtime validation was skipped because static validation found errors.',
            source: 'runtime', suggestion: 'Fix the static errors first; a script that cannot parse cannot run.',
          })
          runtime = skippedRuntime('static errors present', mode, runtimeDiagnostics)
        } else {
          let overrides
          try {
            overrides = resolveRuntimeOverrides(services.config, args)
          } catch (error) {
            runtimeDiagnostics.push({ severity: 'error', code: 'RB5904', message: error.message, source: 'runtime' })
            runtime = skippedRuntime('invalid runtime options', mode, runtimeDiagnostics)
            overrides = null
          }
          if (overrides !== null) {
            if (typeof overrides.binary === 'string' && overrides.binary.length > 0 && !overrides.binary.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(overrides.binary)) {
              overrides.binary = resolve(workspace, overrides.binary)
            }
            const detection = findRevBayes({ binary: overrides.binary })
            if (!detection.found) {
              runtimeDiagnostics.push({
                severity: 'info', code: 'RB5902', message: 'RevBayes executable not found; runtime validation was not attempted.',
                source: 'runtime',
                suggestion: 'Install RevBayes (rb) and put it on PATH, or set revbayesBinary in the plugin config or binary on the call. Static validation still ran.',
              })
              runtime = skippedRuntime('RevBayes binary not found', mode, runtimeDiagnostics)
              runtime.binary = null
            } else {
              const runtimeMode = mode === 'auto' ? services.config.defaultRuntimeMode : (mode === 'smoke' ? 'smoke' : 'dry')
              const run = await runRevBayes({
                binary: detection.path,
                script: currentSource,
                baseDir,
                mode: runtimeMode,
                timeoutMs: overrides.timeoutMs,
                maxRunGenerations: overrides.maxRunGenerations,
                keepTemp: overrides.keepTemp,
                tempRoot: overrides.tempRoot,
                catalog: services.catalog,
                signal: exec.signal,
              })
              runtime = {
                requested: true,
                attempted: run.attempted === true,
                ok: run.ok,
                mode: run.mode,
                binary: detection.path,
                binary_version: detection.version,
                exit_code: run.exitCode,
                timed_out: run.timedOut,
                duration_ms: run.durationMs,
                skipped_reason: run.skippedReason ?? null,
                notes: run.notes,
                temp_dir: run.tempDir,
                stdout_excerpt: run.stdoutExcerpt,
                diagnostics: run.diagnostics,
              }
              runtimeDiagnostics.push(...run.diagnostics)
            }
          } else {
            runtime = skippedRuntime('invalid runtime options', mode, runtimeDiagnostics)
          }
        }
      } else {
        runtime.requested = false
      }

      const allDiagnostics = mergeDiagnostics(staticResult.diagnostics, runtimeDiagnostics)
      const summary = summarizeDiagnostics(allDiagnostics)
      let returnedDiagnostics = allDiagnostics
      if (allDiagnostics.length > maxDiagnostics) {
        returnedDiagnostics = allDiagnostics.slice(0, maxDiagnostics)
        returnedDiagnostics.push({
          severity: 'info', code: 'RB5903',
          message: `${allDiagnostics.length - maxDiagnostics} additional diagnostic(s) were omitted.`,
          source: 'static', suggestion: 'Raise max_diagnostics or fix the first errors.',
        })
      }
      let ok
      if (mode === 'static' || (mode === 'auto' && !runtime.attempted)) ok = staticResult.ok
      else if (mode === 'auto') ok = staticResult.ok && runtime.ok
      else ok = staticResult.ok && runtime.attempted && runtime.ok

      const value = {
        ok,
        target: {
          path: targetPath,
          source: hasPath ? 'file' : 'text',
          lines: currentSource.split('\n').length,
          bytes: Buffer.byteLength(currentSource, 'utf8'),
          base_dir: baseDir,
        },
        static: {
          ok: staticResult.ok,
          summary: staticResult.summary,
          stats: staticResult.stats,
          diagnostics: staticResult.diagnostics,
        },
        runtime,
        diagnostics: returnedDiagnostics,
        summary,
        ...(currentSource !== source ? { fixed_script: currentSource } : {}),
        ...(fixes === undefined ? {} : { fixes }),
      }
      return value
    },
  }
}
