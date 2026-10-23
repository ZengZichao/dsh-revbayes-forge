/**
 * Execution-time RevBayes validation.
 *
 * Two safe modes:
 *  - `dry` executes the script up to (but not including) the first top-level
 *    `mcmc.run()` statement, so data loading, model construction, moves,
 *    monitors and the MCMC object are checked without sampling.
 *  - `smoke` rewrites that first run to a small generation count and stops
 *    after it, so moves and monitors are exercised end-to-end.
 *
 * Output files are redirected into a temporary directory; the script runs with
 * the original script's directory as its working directory so relative input
 * paths keep working. Nothing is executed through a shell.
 */
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { parse } from './parser.js'
import { diagnoseRuntime, buildCallLineIndex } from './diagnostics.js'

const MAX_BINARY_OUTPUT_BYTES = 2 * 1024 * 1024

function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function parseVersion(text) {
  const match = String(text).match(/RevBayes\s+version\s+([^\s,;]+)/i)
  if (match !== null) return match[1]
  const first = String(text).split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0 && !/^revbayes$/i.test(l))
  return first ?? null
}

function probeBinary(path, explicit = false) {
  if (!isExecutableFile(path)) return null
  for (const flag of ['--version', '-v']) {
    const [command, args] = executableCommand(path, [flag])
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' })
    if (result.error === undefined && result.status === 0) {
      const output = `${result.stdout}\n${result.stderr}`
      const version = parseVersion(output)
      const namedLikeRevBayes = /^(rb|revbayes)(\.exe)?$/i.test(basename(path))
      const versionLike = /^\s*v?\d+\.\d+(\.\d+)?/m.test(output)
      if (/RevBayes/i.test(output) || (namedLikeRevBayes && versionLike)) {
        return { path, version, versionFlag: flag }
      }
      // A configured executable is trusted even if its version banner differs.
      if (explicit) return { path, version, versionFlag: flag }
      return null
    }
  }
  // Old builds may not implement --version; an explicit path is still usable.
  return explicit ? { path, version: null, versionFlag: null } : null
}

/**
 * On Windows a shebang script (used by the test stand-in) cannot be spawned
 * directly; run it through the current Node executable instead. Real RevBayes
 * binaries are left untouched.
 */
function executableCommand(path, args) {
  if (process.platform === 'win32' && /\.(mjs|js|cjs)$/i.test(path)) {
    return [process.execPath, [path, ...args]]
  }
  return [path, args]
}

/** Render monitor paths with forward slashes, which RevBayes accepts on every platform. */
function scriptPath(path) {
  return path.replaceAll('\\', '/')
}

/**
 * Discover a RevBayes executable from an explicit path, environment, PATH, or
 * a short list of common macOS/Linux install locations.
 * @param {object} options
 * @returns {{found: boolean, path: string|null, source: string|null, version: string|null, checked: string[]}}
 */
export function findRevBayes(options = {}) {
  const checked = []
  const candidates = []
  const push = (path, source) => {
    if (typeof path === 'string' && path.trim().length > 0) candidates.push({ path: path.trim(), source })
  }
  push(options.binary, 'config.revbayesBinary')
  push(process.env.REVBAYES_BIN, 'environment.REVBAYES_BIN')
  push(process.env.REVBAYES, 'environment.REVBAYES')
  push(process.env.RB_BIN, 'environment.RB_BIN')
  const pathEntries = (process.env.PATH ?? '').split(':').filter((p) => p.length > 0)
  const names = process.platform === 'win32' ? ['rb.exe', 'revbayes.exe'] : ['rb', 'revbayes']
  for (const entry of pathEntries) {
    for (const name of names) push(join(entry, name), 'PATH')
  }
  const home = homedir()
  push('/usr/local/bin/rb', 'common')
  push('/opt/homebrew/bin/rb', 'common')
  push('/usr/bin/rb', 'common')
  push(join(home, '.local/bin/rb'), 'common')
  push('/Applications/RevBayes.app/Contents/MacOS/RevBayes', 'common')
  push('/Applications/RevBayes.app/Contents/MacOS/rb', 'common')

  const seen = new Set()
  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate.path) ? candidate.path : resolvePath(candidate.path)
    if (seen.has(absolute)) continue
    seen.add(absolute)
    checked.push(absolute)
    const explicit = candidate.source === 'config.revbayesBinary' || candidate.source.startsWith('environment.')
    const probe = probeBinary(absolute, explicit)
    if (probe !== null) {
      return { found: true, path: probe.path, source: candidate.source, version: probe.version, checked }
    }
  }
  return { found: false, path: null, source: null, version: null, checked }
}

function commentLines(lines, fromIndex) {
  for (let i = Math.max(0, fromIndex); i < lines.length; i += 1) {
    if (!lines[i].startsWith('#')) lines[i] = `# ${lines[i]}`
  }
}

function expressionCalls(node, output = []) {
  if (node === null || node === undefined || typeof node !== 'object') return output
  if (node.type === 'call') {
    output.push(node)
    expressionCalls(node.callee?.type === 'member' ? node.callee.object : node.callee, output)
    for (const arg of node.args ?? []) expressionCalls(arg.value, output)
    return output
  }
  if (node.type === 'member') {
    expressionCalls(node.object, output)
    return output
  }
  if (node.type === 'index') {
    expressionCalls(node.object, output)
    if (Array.isArray(node.indices)) for (const item of node.indices) if (item !== null) expressionCalls(item, output)
    else expressionCalls(node.index, output)
    return output
  }
  if (node.type === 'assign') {
    expressionCalls(node.value, output)
    return output
  }
  if (node.type === 'expr') {
    expressionCalls(node.expression, output)
    return output
  }
  if (node.type === 'binary') {
    expressionCalls(node.left, output)
    expressionCalls(node.right, output)
    return output
  }
  if (node.type === 'unary' || node.type === 'group' || node.type === 'increment') {
    expressionCalls(node.argument ?? node.expression, output)
    return output
  }
  if (node.type === 'vector') {
    for (const item of node.items ?? []) expressionCalls(item, output)
    return output
  }
  return output
}

function walkAny(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return false
  if (visit(node) === true) return true
  const children = []
  switch (node.type) {
    case 'program':
    case 'block': children.push(...(node.body ?? [])); break
    case 'assign': children.push(node.value); break
    case 'expr': children.push(node.expression); break
    case 'for': children.push(node.iterable, node.body); break
    case 'while': children.push(node.condition, node.body); break
    case 'if': children.push(node.condition, node.consequent, node.alternate); break
    case 'call': children.push(node.callee?.type === 'member' ? node.callee.object : node.callee, ...(node.args ?? []).map((a) => a.value)); break
    case 'member': children.push(node.object); break
    case 'index': children.push(node.object, ...(Array.isArray(node.indices) ? node.indices : [node.index])); break
    case 'binary': children.push(node.left, node.right); break
    case 'unary':
    case 'increment': children.push(node.argument); break
    case 'group': children.push(node.expression); break
    case 'vector': children.push(...(node.items ?? [])); break
    case 'function':
    case 'functionDeclaration': children.push(node.body); break
    default: break
  }
  for (const child of children) if (walkAny(child, visit)) return true
  return false
}

/**
 * Find any `.run()`/`.burnin()` call anywhere, including nested blocks.
 * Used to refuse unsafe automatic rewriting instead of running a full MCMC.
 */
export function findAnyRunCall(source) {
  const parsed = parse(source)
  let found = null
  walkAny(parsed.program, (node) => {
    if (node.type === 'call' && node.callee?.type === 'member' && (node.callee.property === 'run' || node.callee.property === 'burnin')) {
      found = node.callee.property
      return true
    }
    return false
  })
  return found
}

/**
 * Locate the first top-level `.run()` or `.burnin()` call.
 * @param {string} source
 * @returns {{statement: object, call: object|null, callName: string|null}|null}
 */
export function findFirstRunStatement(source) {
  const parsed = parse(source)
  for (const statement of parsed.program.body) {
    const calls = expressionCalls(statement)
    for (const call of calls) {
      if (call.callee?.type !== 'member') continue
      const name = call.callee.property
      if (name === 'run' || name === 'burnin') {
        return { statement, call, callName: name }
      }
    }
  }
  return null
}

function rewriteNumber(value, max) {
  return String(Math.max(1, Math.min(Number(value), max)))
}

function replaceRanges(source, replacements) {
  const ordered = [...replacements].sort((a, b) => b.start - a.start)
  let output = source
  for (const replacement of ordered) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end)
  }
  return output
}

function monitorFileName(call) {
  const args = call.args ?? []
  const named = args.find((a) => a.name === 'filename')
  if (named?.value?.type === 'string') return named.value
  return null
}

function rewriteOutputPaths(script, tempDir) {
  const parsed = parse(script)
  const replacements = []
  let counter = 0
  const visit = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (node.type === 'call') {
      const name = node.callee?.type === 'ident' ? node.callee.name : node.callee?.property
      const redirect = ['mnModel', 'mnFile', 'write', 'writeNexus', 'writeDelimitedCharacterData', 'mnCharHistory', 'mnStochasticVariable'].includes(name)
        || (node.callee?.type === 'member' && node.callee.property === 'run')
      if (redirect) {
        const args = [...(node.args ?? [])]
        if (name === 'run') {
          const checkpoint = args.find((a) => a.name === 'checkpointFile')
          if (checkpoint?.value?.type === 'string') {
            const value = checkpoint.value
            counter += 1
            replacements.push({ start: value.start, end: value.end, text: JSON.stringify(scriptPath(join(tempDir, `checkpoint_${counter}${suffixOf(value.value)}`))) })
          }
        } else {
          const fileNode = monitorFileName(node) ?? (name === 'write' || name === 'writeNexus' ? args.find((a) => a.value?.type === 'string')?.value ?? null : null)
          if (fileNode !== null) {
            counter += 1
            const target = scriptPath(join(tempDir, `output_${counter}_${safeBasename(fileNode.value)}`))
            replacements.push({ start: fileNode.start, end: fileNode.end, text: JSON.stringify(target) })
          }
        }
      }
      for (const arg of node.args ?? []) visit(arg.value)
      return
    }
    if (node.type === 'program' || node.type === 'block') {
      for (const statement of node.body ?? []) visit(statement)
      return
    }
    if (node.type === 'assign') {
      visit(node.value)
      return
    }
    if (node.type === 'expr') {
      visit(node.expression)
      return
    }
    if (node.type === 'for') {
      visit(node.iterable)
      visit(node.body)
      return
    }
    if (node.type === 'while') {
      visit(node.condition)
      visit(node.body)
      return
    }
    if (node.type === 'if') {
      visit(node.condition)
      visit(node.consequent)
      visit(node.alternate)
      return
    }
    if (node.type === 'binary') {
      visit(node.left)
      visit(node.right)
      return
    }
    if (node.type === 'functionDeclaration' || node.type === 'function') {
      visit(node.body)
      return
    }
  }
  visit(parsed.program)
  return replaceRanges(script, replacements)
}

function suffixOf(path) {
  const match = String(path).match(/(\.[A-Za-z0-9]{1,8})$/)
  return match?.[1] ?? '.ckp'
}

function safeBasename(path) {
  const name = basename(String(path)).replace(/[^A-Za-z0-9_.-]+/g, '_')
  return name.length > 0 && name !== '.' && name !== '..' ? name : 'output.txt'
}

/**
 * Rewrite a script for dry-run or smoke execution.
 * @param {string} source
 * @param {{mode: 'dry'|'smoke', maxRunGenerations?: number, tempDir?: string|null}} options
 * @returns {{script: string, mode: string, runLine: number|null, truncatedAfterLine: number|null, notes: string[]}}
 */
export function prepareRuntimeScript(source, options = {}) {
  const mode = options.mode === 'smoke' ? 'smoke' : 'dry'
  const maxRunGenerations = Math.max(1, Math.min(Number(options.maxRunGenerations ?? 100) || 100, 100000))
  const tempDir = options.tempDir ?? null
  const notes = []
  const found = findFirstRunStatement(source)
  let transformed = source
  let runLine = null
  let truncatedAfterLine = null

  if (found === null) {
    const nested = findAnyRunCall(source)
    if (nested !== null) {
      return {
        script: source,
        mode,
        runLine: null,
        truncatedAfterLine: null,
        safe: false,
        notes: [`Found a nested .${nested}() call. Runtime validation only rewrites top-level run statements, so the script was not executed.`],
      }
    }
  }

  if (found !== null) {
    runLine = found.statement.line
    if (mode === 'smoke') {
      const replacements = []
      const generations = found.call.args?.find((a) => a.name === 'generations' || a.name === 'generation' || (a.name === null && found.call.args.indexOf(a) === 0))
      if (generations?.value?.type === 'number') {
        replacements.push({ start: generations.value.start, end: generations.value.end, text: rewriteNumber(generations.value.value, maxRunGenerations) })
      } else if (generations === undefined) {
        const insertAt = found.call.end - 1
        replacements.push({ start: insertAt, end: insertAt, text: found.call.args?.length > 0 ? `, generations=${maxRunGenerations}` : `generations=${maxRunGenerations}` })
      }
      const tuning = found.call.args?.find((a) => a.name === 'tuningInterval' || a.name === 'tuning_interval')
      if (tuning?.value?.type === 'number' && Number(tuning.value.value) > maxRunGenerations) {
        replacements.push({ start: tuning.value.start, end: tuning.value.end, text: String(Math.min(100, maxRunGenerations)) })
      }
      transformed = replaceRanges(transformed, replacements)
      if (tempDir !== null) transformed = rewriteOutputPaths(transformed, tempDir)
      const lines = transformed.split('\n')
      const endLine = found.statement.endLine
      commentLines(lines, endLine)
      transformed = lines.join('\n')
      truncatedAfterLine = endLine
      notes.push(`smoke run: first ${found.callName}() capped at ${maxRunGenerations} generations; execution stops after line ${endLine}.`)
    } else {
      if (tempDir !== null) transformed = rewriteOutputPaths(transformed, tempDir)
      const lines = transformed.split('\n')
      commentLines(lines, found.statement.line - 1)
      transformed = lines.join('\n')
      truncatedAfterLine = found.statement.line - 1
      notes.push(`dry run: the first ${found.callName}() and all later statements are commented out; model setup executes.`)
    }
  } else {
    notes.push('No top-level .run() found; the script is executed as-is.')
  }

  return { script: transformed, mode, runLine, truncatedAfterLine, safe: true, notes }
}

function captureChild(child, timeoutMs, externalSignal) {
  return new Promise((resolve) => {
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let aborted = false
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }, Math.max(1000, timeoutMs))
    const onAbort = () => {
      aborted = true
      try { child.kill('SIGTERM') } catch { /* already gone */ }
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, 1500).unref?.()
    }
    if (externalSignal !== undefined && externalSignal !== null) {
      if (externalSignal.aborted) onAbort()
      else externalSignal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout?.on('data', (chunk) => {
      if (stdoutBytes >= MAX_BINARY_OUTPUT_BYTES) return
      stdoutBytes += chunk.length
      stdout.push(chunk.subarray(0, Math.max(0, MAX_BINARY_OUTPUT_BYTES - (stdoutBytes - chunk.length))))
    })
    child.stderr?.on('data', (chunk) => {
      if (stderrBytes >= MAX_BINARY_OUTPUT_BYTES) return
      stderrBytes += chunk.length
      stderr.push(chunk.subarray(0, Math.max(0, MAX_BINARY_OUTPUT_BYTES - (stderrBytes - chunk.length))))
    })
    child.on('error', (error) => finish({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: null, signal: null, timedOut, aborted, spawnError: error }))
    child.on('close', (code, signal) => finish({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code, signal, timedOut, aborted, spawnError: null }))
  })
}

/**
 * Run one RevBayes script in dry or smoke mode.
 * @param {object} options
 * @param {string} options.binary RevBayes executable.
 * @param {string} options.script original script text.
 * @param {string|null} options.baseDir working directory for the run.
 * @param {'dry'|'smoke'} options.mode
 * @param {number} options.timeoutMs
 * @param {number} options.maxRunGenerations
 * @param {boolean} options.keepTemp
 * @param {string|null} options.tempRoot
 * @param {object} options.catalog
 * @param {AbortSignal|undefined} options.signal
 * @returns {Promise<object>}
 */
export async function runRevBayes(options) {
  const started = Date.now()
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs ?? 120000) || 120000, 30 * 60 * 1000))
  const maxRunGenerations = Math.max(1, Math.min(Number(options.maxRunGenerations ?? 100) || 100, 100000))
  const tempRoot = options.tempRoot === undefined || options.tempRoot === null ? tmpdir() : options.tempRoot
  mkdirSync(tempRoot, { recursive: true })
  const tempDir = mkdtempSync(join(tempRoot, 'revbayes-forge-'))
  const scriptPath = join(tempDir, 'analysis.Rev')
  const baseDir = options.baseDir !== undefined && options.baseDir !== null ? resolvePath(options.baseDir) : process.cwd()
  const prepared = prepareRuntimeScript(options.script, { mode: options.mode, maxRunGenerations, tempDir })
  if (prepared.safe === false) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* best effort */ }
    const diagnostic = {
      severity: 'error', code: 'RB5905',
      message: 'Runtime validation skipped: a .run()/.burnin() call is nested inside a block or function and cannot be safely rewritten.',
      line: 0, column: 0, source: 'runtime',
      suggestion: 'Move the MCMC run to top-level statements, or use static validation and run the script manually.',
    }
    return {
      requested: true,
      attempted: false,
      ok: false,
      mode: prepared.mode,
      binary: options.binary,
      baseDir,
      tempDir: null,
      scriptPath: null,
      command: [options.binary, scriptPath],
      exitCode: null,
      signal: null,
      timedOut: false,
      aborted: false,
      durationMs: Date.now() - started,
      runLine: null,
      truncatedAfterLine: null,
      notes: prepared.notes,
      diagnostics: [diagnostic],
      summary: { error: 1, warning: 0, info: 0 },
      stdoutExcerpt: '',
      artifacts: [],
      skippedReason: 'nested run call',
    }
  }
  writeFileSync(scriptPath, prepared.script, 'utf8')

  const callLines = buildCallLineIndex(options.script)
  let result
  try {
    const [command, args] = executableCommand(options.binary, [scriptPath])
    const child = spawn(command, args, {
      cwd: baseDir,
      shell: false,
      env: { ...process.env, REVBAYES_FORGE_VALIDATION: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    result = await captureChild(child, timeoutMs, options.signal)
  } catch (error) {
    result = { stdout: '', stderr: String(error?.message ?? error), exitCode: null, signal: null, timedOut: false, aborted: false, spawnError: error }
  }

  const diagnosis = diagnoseRuntime({
    stdout: result.stdout,
    stderr: result.spawnError === null ? result.stderr : `${result.stderr}\nError: could not start RevBayes: ${result.spawnError?.message ?? result.spawnError}`,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    catalog: options.catalog,
    callLines,
    timeoutMs,
  })
  let runtimeOk = result.exitCode === 0 && !result.timedOut && !result.aborted && result.spawnError === null
    && diagnosis.diagnostics.every((d) => d.severity !== 'error')
  if (result.aborted) {
    diagnosis.diagnostics.unshift({
      severity: 'error', code: 'RB6996', message: 'The RevBayes run was cancelled by the caller.', line: 0, column: 0, source: 'runtime',
      suggestion: 'Re-run validation when the session is idle.',
    })
    runtimeOk = false
  }

  const kept = options.keepTemp === true
  let artifacts = []
  try {
    artifacts = statSync(tempDir).isDirectory() ? readdirSafe(tempDir) : []
  } catch {
    artifacts = []
  }
  if (!kept) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  return {
    requested: true,
    attempted: true,
    ok: runtimeOk,
    skippedReason: null,
    mode: prepared.mode,
    binary: options.binary,
    baseDir,
    tempDir: kept ? tempDir : null,
    scriptPath: kept ? scriptPath : null,
    command: [options.binary, scriptPath],
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    durationMs: Date.now() - started,
    runLine: prepared.runLine,
    truncatedAfterLine: prepared.truncatedAfterLine,
    notes: prepared.notes,
    diagnostics: diagnosis.diagnostics,
    summary: diagnosis.summary,
    stdoutExcerpt: diagnosis.excerpt,
    artifacts,
  }
}

function readdirSafe(path) {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/**
 * Check the RevBayes environment without executing a script.
 * @param {object} options
 * @returns {object}
 */
export function checkEnvironment(options = {}) {
  const detection = findRevBayes(options)
  return {
    found: detection.found,
    binary: detection.path,
    source: detection.source,
    version: detection.version,
    checked: detection.checked.slice(0, 20),
    tempRoot: options.tempRoot ?? tmpdir(),
    timeoutMs: options.timeoutMs ?? 120000,
    maxRunGenerations: options.maxRunGenerations ?? 100,
    allowRuntime: options.allowRuntime !== false,
  }
}
