/**
 * RevBayes runtime-output diagnosis.
 *
 * RevBayes reports errors as tab-prefixed lines (`Error:\t...`), sometimes with
 * a "Provided call / Correct usage" block, sometimes only a one-line message.
 * This module turns that text into the same diagnostic vocabulary as the static
 * validator and adds actionable suggestions.
 */
import { nearestName, resolveEntry } from './catalog.js'

const KNOWN_ERROR_HINTS = [
  {
    pattern: /No overloaded function '([^']+)' matches for arguments/i,
    code: 'RB6001',
    explain: (m) => `RevBayes found no overload of '${m[1]}' matching the supplied argument types.`,
  },
  {
    pattern: /Unknown function '?([^'\s]+)'?/i,
    code: 'RB6001',
    explain: (m) => `RevBayes does not know the function '${m[1]}'.`,
  },
  {
    pattern: /No function named '([^']+)'/i,
    code: 'RB6001',
    explain: (m) => `RevBayes does not know the function '${m[1]}'.`,
  },
  {
    pattern: /Argument or label mismatch for function call/i,
    code: 'RB6002',
    explain: () => 'The call arguments do not match any documented overload (wrong names, order, or count).',
  },
  {
    pattern: /Missing Variable:\s*Variable ([^\s]+) does not exist/i,
    code: 'RB6003',
    explain: (m) => `The variable '${m[1]}' has not been defined at this point.`,
  },
  {
    pattern: /Variable "?([^"\s]+)"? does not exist/i,
    code: 'RB6003',
    explain: (m) => `The variable '${m[1]}' has not been defined at this point.`,
  },
  {
    pattern: /(?:Could not open|Could not find|Unable to open|No such file|file not found|cannot open)[^\n]*?["']?([^"'\n]+)["']?/i,
    code: 'RB6004',
    explain: () => 'A file could not be opened. Check the path and the working directory.',
  },
  {
    pattern: /Index (-?\d+) not allowed in '([^']+)'/i,
    code: 'RB6005',
    explain: (m) => `Index ${m[1]} is invalid for ${m[2]}; RevBayes vectors are 1-based.`,
  },
  {
    pattern: /Index should be of type (\w+), but is of type (\w+)/i,
    code: 'RB6005',
    explain: (m) => `An index has type ${m[2]}, but ${m[1]} is required.`,
  },
  {
    pattern: /SSE model has (\d+) states, but observed data set has (\d+) states/i,
    code: 'RB6006',
    explain: (m) => `The model has ${m[1]} states but the data have ${m[2]} states.`,
  },
  {
    pattern: /Cannot complete this assignment: '([^']+)' depends on '([^']+)'/i,
    code: 'RB6007',
    explain: (m) => `The assignment would create a circular dependency between '${m[1]}' and '${m[2]}'.`,
  },
  {
    pattern: /Could not compute lnProb for node '([^']+)': lnProb = inf/i,
    code: 'RB6008',
    explain: (m) => `The prior or likelihood of '${m[1]}' evaluated to infinity; a parameter is outside its prior support.`,
  },
  {
    pattern: /Newick error at line (\d+), column (\d+)/i,
    code: 'RB6009',
    explain: (m) => `The Newick tree is malformed at line ${m[1]}, column ${m[2]}.`,
  },
  {
    pattern: /Could not parse '([^']+)' as a number[^.]*?line (\d+) of ([^*]+)/i,
    code: 'RB6004',
    explain: (m) => `The value '${m[1]}' on line ${m[2]} of ${m[3].trim()} is not a number.`,
  },
]

function extractContext(lines, index) {
  const context = { provided: null, correct: null, potential: [] }
  for (let i = index + 1; i < Math.min(lines.length, index + 40); i += 1) {
    const line = lines[i].trim()
    if (/^Provided call:/i.test(line)) {
      const block = []
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
        const next = lines[j].trimEnd()
        if (/^Correct usage/is.test(next.trim()) || /^Missing Variable/i.test(next.trim()) || /^Error:/i.test(next.trim())) break
        block.push(next)
      }
      context.provided = block.join(' ').replace(/\s+/g, ' ').trim()
    }
    if (/^Correct usage is:/i.test(line)) {
      const block = []
      for (let j = i + 1; j < Math.min(lines.length, i + 16); j += 1) {
        const next = lines[j].trimEnd()
        if (/^Missing Variable/i.test(next.trim()) || /^Error:/i.test(next.trim()) || /^Provided call/i.test(next.trim())) break
        block.push(next)
      }
      context.correct = block.join(' ').replace(/\s+/g, ' ').trim()
    }
    if (/^Potentially matching functions are:/i.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
        const next = lines[j].trim()
        if (next.length === 0) break
        context.potential.push(next.replace(/\s+/g, ' '))
      }
    }
  }
  return context
}

function callNameFromProvided(provided) {
  if (typeof provided !== 'string') return null
  const match = provided.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/)
  return match?.[1] ?? null
}

function expectedUsages(catalog, name) {
  if (catalog === undefined || name === null) return []
  const entry = resolveEntry(catalog, name)
  if (entry === null) return []
  return [...(entry.signatures ?? [])].slice(0, 2).map((s) => s.usage)
}

/**
 * Parse RevBayes stdout/stderr into structured diagnostics.
 * @param {object} input
 * @param {string} input.stdout
 * @param {string} input.stderr
 * @param {number|null} input.exitCode
 * @param {string|null} input.signal
 * @param {boolean} input.timedOut
 * @param {object} [input.catalog]
 * @param {Map<string, number>} [input.callLines] call name -> first line in the script
 * @param {number} [input.timeoutMs]
 * @returns {{diagnostics: object[], summary: object, excerpt: string}}
 */
export function diagnoseRuntime(input) {
  const stdout = input.stdout ?? ''
  const stderr = input.stderr ?? ''
  const combined = [stderr, stdout].filter((s) => s.length > 0).join('\n')
  const lines = combined.split(/\r?\n/)
  const diagnostics = []
  const seen = new Set()
  const callLines = input.callLines ?? new Map()
  let pendingCall = null
  let pendingContextIndex = -1

  const add = (diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.message}`
    if (seen.has(key)) return
    seen.add(key)
    diagnostics.push(diagnostic)
  }

  const lineFor = (name) => (name !== null && callLines.has(name) ? callLines.get(name) : 0)

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.trim()
    if (line.length === 0) continue

    const isError = /^Error:/i.test(line) || /^Missing Variable:/i.test(line)
    const isWarning = /^Warning:/i.test(line)
    if (!isError && !isWarning) continue

    const body = line.replace(/^(?:Error|Warning|Missing Variable):\s*/i, '').trim()
    const problemLine = body.match(/Problem processing line (\d+) in file/i)
    if (problemLine !== null) {
      // RevBayes follows an error with a location line. Attach it to the error
      // instead of producing a second, redundant diagnostic.
      const last = diagnostics.at(-1)
      if (last !== undefined && (last.line === 0 || last.line === undefined)) last.line = Number(problemLine[1])
      continue
    }
    let matched = null
    for (const hint of KNOWN_ERROR_HINTS) {
      const match = body.match(hint.pattern)
      if (match !== null) {
        matched = { hint, match }
        break
      }
    }

    if (matched === null) {
      add({
        severity: isWarning ? 'warning' : 'error',
        code: isWarning ? 'RB6010' : 'RB6999',
        message: body,
        line: pendingCall === null ? 0 : lineFor(pendingCall),
        column: 0,
        source: 'runtime',
      })
      continue
    }

    const { hint, match } = matched
    const context = extractContext(lines, i)
    const providedName = callNameFromProvided(context.provided)
      ?? (hint.code === 'RB6001' ? (match[1] ?? null) : null)
      ?? pendingCall
    const usages = expectedUsages(input.catalog, providedName)
    let suggestion = null
    if (hint.code === 'RB6002') {
      suggestion = context.correct !== null
        ? `Match the correct usage: ${context.correct}`
        : (usages.length > 0 ? `Use one of: ${usages.join(' OR ')}` : 'Check the argument names, order, and count against the function help.')
    } else if (hint.code === 'RB6001') {
      if (usages.length > 0) suggestion = `Expected usage: ${usages.join(' OR ')}`
      else if (providedName !== null && input.catalog !== undefined) {
        const known = [...input.catalog.callableNames].sort()
        const nearest = nearestName(providedName, known, 2)
        if (nearest !== null) suggestion = `Did you mean '${nearest}'?`
      }
    } else if (hint.code === 'RB6003') {
      suggestion = `Define '${match[1]}' before this line (read data, assign a value, or fix the spelling).`
    } else if (hint.code === 'RB6004') {
      suggestion = 'Use an absolute path, or run RevBayes from the directory that contains the referenced file.'
    } else if (hint.code === 'RB6005') {
      suggestion = 'RevBayes indices start at 1; adjust loop bounds and index expressions.'
    } else if (hint.code === 'RB6006') {
      suggestion = `Use a state count matching the data (for example fnJC(${match[2]}) and type="Standard").`
    } else if (hint.code === 'RB6007') {
      suggestion = 'Break the cycle by defining a constant first, or use <- instead of a mutually dependent assignment.'
    } else if (hint.code === 'RB6008') {
      suggestion = 'Check the prior bounds and the starting values; a parameter probably moved outside its support.'
    } else if (hint.code === 'RB6009') {
      suggestion = 'Inspect the tree file around the reported line and column.'
    }

    add({
      severity: isWarning ? 'warning' : 'error',
      code: hint.code,
      message: hint.explain(match),
      line: providedName === null ? 0 : lineFor(providedName),
      column: 0,
      source: 'runtime',
      ...(suggestion === null ? {} : { suggestion }),
      ...(context.provided === null ? {} : { providedCall: context.provided }),
      ...(context.correct === null ? {} : { correctUsage: context.correct }),
    })
    pendingCall = providedName
    pendingContextIndex = i
  }

  if (diagnostics.length === 0) {
    if (input.timedOut === true) {
      diagnostics.push({
        severity: 'error',
        code: 'RB6998',
        message: `RevBayes did not finish within ${input.timeoutMs ?? 'the configured'} ms.`,
        line: 0,
        column: 0,
        source: 'runtime',
        suggestion: 'Increase the timeout, reduce maxRunGenerations, or investigate a hang in the model setup.',
      })
    } else if (input.signal !== null && input.signal !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'RB6997',
        message: `RevBayes was terminated by signal ${input.signal}.`,
        line: 0,
        column: 0,
        source: 'runtime',
        suggestion: 'Check memory use and the process supervisor; the script may have crashed.',
      })
    } else if (typeof input.exitCode === 'number' && input.exitCode !== 0) {
      diagnostics.push({
        severity: 'error',
        code: 'RB6999',
        message: `RevBayes exited with code ${input.exitCode} without a recognisable error message.`,
        line: 0,
        column: 0,
        source: 'runtime',
        suggestion: 'Inspect the captured stdout/stderr excerpt for the first failure.',
      })
    }
  }

  const counts = { error: 0, warning: 0, info: 0 }
  for (const diagnostic of diagnostics) counts[diagnostic.severity] = (counts[diagnostic.severity] ?? 0) + 1
  const compact = combined.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const excerpt = compact.slice(0, 60).join('\n') + (compact.length > 60 ? `\n... (${compact.length - 60} more lines)` : '')
  return { diagnostics, summary: counts, excerpt }
}

/**
 * Build a call-name -> line index for runtime diagnostics attribution.
 * @param {string} source
 * @returns {Map<string, number>}
 */
export function buildCallLineIndex(source) {
  // A light-weight scan is enough: runtime attribution only needs the first
  // line where a function/method name appears as a call.
  const map = new Map()
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/#.*$/, '')
    for (const match of line.matchAll(/(?:([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const name = match[2]
      if (name === undefined) continue
      if (!map.has(name)) map.set(name, i + 1)
    }
  }
  return map
}

export { KNOWN_ERROR_HINTS }
