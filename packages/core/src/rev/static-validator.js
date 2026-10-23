/**
 * Static validation for RevBayes scripts.
 *
 * Three layers, in increasing specificity:
 *   1. lexical/structure: strings, brackets, statement shape;
 *   2. signatures: every call is matched against the RevBayes help catalog,
 *      including named arguments, required/optional arguments, and enum options;
 *   3. semantics: variables, tree assembly, MCMC wiring, model clamping, and
 *      file references.
 *
 * The validator never executes the script. Runtime checks live in runtime.js.
 */
import { parse } from './parser.js'
import {
  editDistance,
  isKnownCallable,
  isLooseSignature,
  methodsFor,
  nearestName,
  resolveEntry,
} from './catalog.js'
import { statSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'

const ASSIGN_OPERATORS = new Set(['<-', ':=', '~', '='])
const HIGH_CONFIDENCE_ARG_TYPOS = new Map([
  ['generation', 'generations'],
  ['burning', 'burnin'],
  ['thin', 'thinning'],
])

const FILE_READ_CALLS = new Set([
  'readDiscreteCharacterData',
  'readCharacterDataDelimited',
  'readDelimitedCharacterData',
  'readTrees',
  'readTreeTrace',
  'readTrace',
  'readDataDelimitedFile',
  'readDelimitedDataFile',
  'readNexus',
  'source',
])

function lineStartsOf(source) {
  const starts = [0]
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function positionAt(lineStarts, offset) {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lineStarts[mid] <= offset) low = mid + 1
    else high = mid - 1
  }
  const line = Math.max(0, high)
  return { line: line + 1, column: offset - lineStarts[line] + 1 }
}

function rootName(node) {
  let current = node
  while (current !== null && current !== undefined) {
    if (current.type === 'ident') return current.name
    if (current.type === 'index') {
      current = current.object
      continue
    }
    if (current.type === 'member') {
      current = current.object
      continue
    }
    if (current.type === 'group') {
      current = current.expression
      continue
    }
    return null
  }
  return null
}

function calleeInfo(callee) {
  if (callee?.type === 'ident') return { name: callee.name, kind: 'identifier', property: null, receiver: null }
  if (callee?.type === 'member') {
    return { name: callee.property, kind: 'member', property: callee.property, receiver: callee.object }
  }
  return { name: null, kind: 'expression', property: null, receiver: null }
}

function typesOf(param) {
  return String(param?.type ?? '')
    .split('|')
    .map((t) => t.replace(/<[^>]*>/g, '').replace(/\[\]/g, '').trim())
    .filter((t) => t.length > 0)
}

function isNumericType(type) {
  return ['Natural', 'Integer', 'Real', 'RealPos', 'Probability', 'Simplex', 'Natural[]', 'Integer[]', 'Real[]', 'RealPos[]'].includes(type)
    || ['Natural', 'Integer', 'Real', 'RealPos', 'Probability'].some((t) => type.startsWith(t))
}

function accepts(signature, args) {
  const params = signature.params ?? []
  const named = args.filter((a) => a.name !== null)
  const positional = args.filter((a) => a.name === null)
  if (params.length === 0) return positional.length === 0 && named.length === 0
  const variadic = params.some((p) => p.variadic)
  const filled = new Set()
  for (const arg of named) {
    const index = params.findIndex((p, i) => p.name === arg.name && !filled.has(i))
    if (index < 0) return false
    filled.add(index)
  }
  let remaining = positional.length
  for (let i = 0; i < params.length && remaining > 0; i += 1) {
    if (filled.has(i)) continue
    if (params[i].variadic) {
      remaining = 0
      break
    }
    filled.add(i)
    remaining -= 1
  }
  if (remaining > 0 && !variadic) return false
  // `readTrees(file, text, ...)` documents both inputs as required; they are
  // alternatives in the implementation. Require one of them, not both.
  const fileParam = params.findIndex((p) => p.name === 'file')
  const textParam = params.findIndex((p) => p.name === 'text')
  const fileTextAlternative = fileParam >= 0 && textParam >= 0 && params[fileParam].required && params[textParam].required
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i]
    if (fileTextAlternative && (i === fileParam || i === textParam)) continue
    if (param.required && !param.variadic && !filled.has(i)) return false
  }
  if (fileTextAlternative && !filled.has(fileParam) && !filled.has(textParam)) return false
  return true
}

/**
 * Fallback matcher for help signatures whose optional arguments precede a
 * required one (for example dnUniformTopologyBranchLength(taxa,
 * outgroup, branchLengthDistribution)). Positional arguments fill required
 * parameters first, then optional ones, preserving order.
 */
function acceptsRequiredFirst(signature, args) {
  const params = signature.params ?? []
  if (params.some((p) => p.variadic)) return false
  const named = args.filter((a) => a.name !== null)
  const positional = args.filter((a) => a.name === null)
  const filled = new Set()
  for (const arg of named) {
    const index = params.findIndex((p, i) => p.name === arg.name && !filled.has(i))
    if (index < 0) return false
    filled.add(index)
  }
  const order = [...params.keys()].filter((i) => !filled.has(i))
  const requiredFirst = [...order].sort((a, b) => Number(params[b].required) - Number(params[a].required))
  let cursor = 0
  for (const arg of positional) {
    while (cursor < requiredFirst.length && filled.has(requiredFirst[cursor])) cursor += 1
    if (cursor >= requiredFirst.length) return false
    filled.add(requiredFirst[cursor])
    cursor += 1
  }
  for (let i = 0; i < params.length; i += 1) {
    if (params[i].required && !params[i].variadic && !filled.has(i)) return false
  }
  return true
}

function expectedUsage(signatures, limit = 2) {
  return signatures.slice(0, limit).map((s) => s.usage).join(' OR ')
}

function bestParamForArg(signature, args, index) {
  const params = signature.params ?? []
  const positionalIndex = args.slice(0, index).filter((a) => a.name === null).length
  const arg = args[index]
  if (arg.name !== null) return params.find((p) => p.name === arg.name) ?? null
  return params[positionalIndex] ?? null
}

function literalTypeName(node) {
  if (node === null || node === undefined) return 'unknown'
  if (node.type === 'number') return 'number'
  if (node.type === 'string') return 'string'
  if (node.type === 'boolean') return 'boolean'
  if (node.type === 'null') return 'null'
  if (node.type === 'vector') return 'vector'
  if (node.type === 'ident') return 'identifier'
  if (node.type === 'call') return 'call'
  return node.type
}

function sourceSlice(source, node) {
  if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return ''
  return source.slice(node.start, node.end)
}

/**
 * Validate one Rev script.
 * @param {string} source
 * @param {object} options
 * @param {object} options.catalog loaded signature catalog
 * @param {string|null} options.sourcePath path for diagnostics (display)
 * @param {string|null} options.baseDir directory for relative file checks
 * @param {boolean} options.checkFiles check referenced input files exist
 * @param {string} options.strict 'off'|'warnings'|'all' influences severity of soft checks
 * @returns {object} validation result with diagnostics and statistics
 */
export function validateScript(source, options = {}) {
  const catalog = options.catalog
  if (catalog === undefined || catalog === null) throw new Error('validateScript requires a signature catalog')
  const checkFiles = options.checkFiles === true
  const strictMode = options.strict === true
  const baseDir = options.baseDir ?? null
  const lineStarts = lineStartsOf(source)
  const parsed = parse(source)
  const diagnostics = []
  const seen = new Set()
  const add = (diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`
    if (seen.has(key)) return
    seen.add(key)
    diagnostics.push(diagnostic)
  }
  const at = (nodeOrToken, fallbackLine = 1) => {
    const start = typeof nodeOrToken === 'number' ? nodeOrToken : nodeOrToken?.start
    if (typeof start === 'number') return positionAt(lineStarts, start)
    return { line: fallbackLine, column: 1 }
  }
  const make = (severity, code, message, node, extra = {}) => {
    const pos = at(node, extra.line ?? 1)
    const end = typeof node?.end === 'number'
      ? positionAt(lineStarts, Math.max(node.end - 1, node.start ?? 0))
      : { line: pos.line, column: pos.column }
    return {
      severity,
      code,
      message,
      line: pos.line,
      column: pos.column,
      endLine: end.line,
      endColumn: end.column,
      source: 'static',
      ...extra,
    }
  }

  for (const error of parsed.errors) {
    add({
      severity: error.severity ?? 'error',
      code: error.code,
      message: error.message,
      line: error.line,
      column: error.column,
      endLine: error.endLine ?? error.line,
      endColumn: error.endColumn ?? error.column,
      source: 'static',
      ...(error.suggestion === undefined ? {} : { suggestion: error.suggestion }),
      ...(typeof error.start === 'number' ? { fix: { kind: 'replace', start: error.start, end: error.end, text: '', safety: 'review' } } : {}),
    })
  }

  // ---------- pass 1: definitions, calls, roles, file references ----------
  const defined = new Map()
  const userFunctions = new Map()
  const calls = []
  const assignments = []
  const roles = new Map()
  const monitorFiles = new Map()
  const fileRefs = []
  let hasClamp = false
  let hasMoves = false
  let hasMonitors = false
  let hasMcmc = false
  let hasRun = false
  let hasSource = false
  let phyloCTMCCalls = 0
  let functionCount = 0
  let callCount = 0

  const define = (name, kind, node) => {
    if (typeof name !== 'string' || name.length === 0) return
    const current = defined.get(name)
    if (current === undefined || current.kind !== 'function') defined.set(name, { kind, node, line: node?.line ?? 1 })
  }

  const walk = (node, parent = null) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    switch (node.type) {
      case 'program':
      case 'block':
        for (const statement of node.body ?? []) walk(statement, node)
        break
      case 'assign': {
        assignments.push(node)
        const targetName = rootName(node.target)
        if (targetName !== null) define(targetName, node.operator === '~' ? 'stochastic' : 'variable', node.target)
        if (node.target?.type === 'index') {
          // base name is defined by the assignment as well
          if (targetName !== null) define(targetName, node.operator === '~' ? 'stochastic' : 'variable', node.target)
        }
        if (node.value?.type === 'function') {
          functionCount += 1
          if (targetName !== null) userFunctions.set(targetName, node.value)
          for (const param of node.value.params ?? []) define(param.name, 'parameter', param.token)
        }
        walk(node.value, node)
        break
      }
      case 'expr':
        walk(node.expression, node)
        break
      case 'for':
        define(node.variable, 'loop', node.variableToken)
        walk(node.iterable, node)
        walk(node.body, node)
        break
      case 'while':
        walk(node.condition, node)
        walk(node.body, node)
        break
      case 'if':
        walk(node.condition, node)
        walk(node.consequent, node)
        walk(node.alternate, node)
        break
      case 'return':
        walk(node.value, node)
        break
      case 'call': {
        callCount += 1
        const info = calleeInfo(node.callee)
        const callRecord = { node, ...info, args: node.args ?? [], line: node.line, parent, piped: parent?.type === 'binary' && parent.operator === '|>' && parent.right === node }
        calls.push(callRecord)
        const values = (node.args ?? []).map((a) => a.value)
        if (info.name === 'VectorMoves' && info.kind === 'identifier' && parent?.type !== 'assign') {
          // handled from the assignment below
        }
        if (info.kind === 'identifier' && info.name === 'source') hasSource = true
        if (info.name === 'clamp') hasClamp = true
        if (info.kind === 'member' && info.property === 'clamp') hasClamp = true
        if (info.kind === 'identifier') {
          if (info.name === 'mcmc') hasMcmc = true
          if (info.name === 'run') hasRun = true
        }
        if (info.kind === 'member' && info.property === 'run' && rootName(info.receiver) !== null) hasRun = true
        if (info.kind === 'member' && info.property === 'append') {
          const receiver = rootName(info.receiver)
          const role = roles.get(receiver)
          if (role === 'moves') hasMoves = true
          if (role === 'monitors') hasMonitors = true
        }
        if (info.kind === 'identifier' && info.name === 'dnPhyloCTMC') phyloCTMCCalls += 1
        if (info.kind === 'identifier' && (info.name === 'mnModel' || info.name === 'mnFile')) {
          const filenameArg = (node.args ?? []).find((a) => a.name === 'filename')
          if (filenameArg?.value?.type === 'string') {
            const key = filenameArg.value.value
            monitorFiles.set(key, (monitorFiles.get(key) ?? 0) + 1)
          }
        }
        if (info.name !== null && FILE_READ_CALLS.has(info.name)) {
          const fileArg = (node.args ?? []).find((a) => a.name === 'file' || a.name === null)
          if (fileArg?.value?.type === 'string') {
            fileRefs.push({ call: info.name, path: fileArg.value.value, node: fileArg.value, line: node.line })
          }
        }
        if (info.kind === 'identifier' && info.name === 'VectorMoves' && parent?.type === 'assign') {
          const target = rootName(parent.target)
          if (target !== null) roles.set(target, 'moves')
        }
        if (info.kind === 'identifier' && info.name === 'VectorMonitors' && parent?.type === 'assign') {
          const target = rootName(parent.target)
          if (target !== null) roles.set(target, 'monitors')
        }
        walk(node.callee?.type === 'member' ? node.callee.object : node.callee, node)
        for (const arg of node.args ?? []) walk(arg.value, node)
        break
      }
      case 'member':
        walk(node.object, node)
        break
      case 'binary':
        walk(node.left, node)
        walk(node.right, node)
        break
      case 'unary':
        walk(node.argument, node)
        break
      case 'group':
        walk(node.expression, node)
        break
      case 'vector':
        for (const item of node.items ?? []) walk(item, node)
        break
      case 'function':
        for (const param of node.params ?? []) {
          define(param.name, 'parameter', param.token)
          walk(param.defaultValue, node)
        }
        walk(node.body, node)
        break
      case 'functionDeclaration':
        functionCount += 1
        define(node.name, 'function', node.nameToken)
        userFunctions.set(node.name, node)
        for (const param of node.params ?? []) define(param.name, 'parameter', param.token)
        walk(node.body, node)
        break
      case 'increment':
        walk(node.argument, node)
        break
      case 'index':
        walk(node.object, node)
        if (Array.isArray(node.indices)) {
          for (const item of node.indices) if (item !== null) walk(item, node)
        } else {
          walk(node.index, node)
        }
        break
      default:
        break
    }
  }
  walk(parsed.program)

  // targets using `moves[i] = ...` imply a move exists when the base is a moves vector
  for (const assignment of assignments) {
    if (assignment.target?.type === 'index' && assignment.target.object?.type === 'ident') {
      const role = roles.get(assignment.target.object.name)
      if (role === 'moves') hasMoves = true
      if (role === 'monitors') hasMonitors = true
    }
  }

  // ---------- pass 2: call signatures, argument semantics, fixes ----------
  const callNames = [...catalog.callableNames].sort()
  const checkLiteral = (call, arg, param, signature, loose) => {
    if (param === null || param === undefined) return
    const node = arg.value
    const types = typesOf(param)
    if (param.options !== null && param.options !== undefined && node?.type === 'string') {
      const value = node.value
      if (!param.options.includes(value)) {
        const suggestion = nearestName(value, param.options, 3)
        add(make(
          (!loose || suggestion !== null) ? 'error' : 'warning',
          'RB3202',
          `"${value}" is not a valid value for '${param.name ?? 'argument'}' in ${signature.name}(). Valid values: ${param.options.map((o) => `"${o}"`).join(', ')}.`,
          arg.nameToken ?? node,
          suggestion === null ? {} : {
            suggestion: `Did you mean "${suggestion}"?`,
            fix: { kind: 'replace', start: node.start, end: node.end, text: JSON.stringify(suggestion), safety: 'safe', description: `Replace with "${suggestion}"` },
          },
        ))
      }
    }
    if (node?.type === 'number') {
      const expectsNumeric = types.some(isNumericType)
      const expectsBool = types.includes('Bool')
      if (expectsBool) {
        add(make(loose ? 'warning' : 'error', 'RB3203', `Argument '${param.name ?? '?'}' expects a boolean (TRUE/FALSE), not a number.`, arg.start ?? node))
      }
      const integerOnly = (types.includes('Natural') || types.includes('Integer'))
        && !types.some((t) => t === 'Probability' || t === 'Real' || t === 'RealPos')
      if (integerOnly) {
        if (!Number.isInteger(node.value)) {
          add(make(loose ? 'warning' : 'error', 'RB3204', `Argument '${param.name ?? '?'}' expects an integer, but got ${node.raw}.`, node))
        }
      }
      if (['Natural', 'RealPos', 'Probability', 'Simplex'].some((t) => types.includes(t)) && node.value < 0) {
        add(make(loose ? 'warning' : 'error', 'RB3205', `Argument '${param.name ?? '?'}' must be non-negative, but got ${node.raw}.`, node))
      }
      const probabilityOnly = types.includes('Probability')
        && !types.some((t) => t === 'Integer' || t === 'Natural' || t === 'Real' || t === 'RealPos')
      if (probabilityOnly && node.value > 1) {
        add(make('error', 'RB3206', `Argument '${param.name ?? '?'}' is a probability and must be between 0 and 1, but got ${node.raw}.`, node))
      }
      if (!expectsNumeric && !expectsBool && (types.includes('String') || types.includes('Bool'))) {
        add(make('warning', 'RB3207', `Argument '${param.name ?? '?'}' expects ${types.join('|')}, but got a number.`, node))
      }
    }
    if (node?.type === 'string') {
      const expectsBool = types.includes('Bool')
      const expectsNumeric = types.some(isNumericType)
      if (expectsBool && (node.value === 'TRUE' || node.value === 'FALSE')) {
        add(make(loose ? 'warning' : 'error', 'RB3208', `Boolean literals are written TRUE/FALSE without quotes.`, node, {
          fix: { kind: 'replace', start: node.start, end: node.end, text: node.value, safety: 'safe', description: 'Remove the quotes' },
        }))
      } else if (expectsNumeric && !types.includes('String') && Number.isNaN(Number(node.value))) {
        add(make('warning', 'RB3209', `Argument '${param.name ?? '?'}' expects ${types.join('|')}, but got the string ${JSON.stringify(node.value)}.`, node))
      }
    }
    if (node?.type === 'boolean' && types.includes('String') && !types.includes('Bool')) {
      add(make('warning', 'RB3210', `Argument '${param.name ?? '?'}' expects a string, but got a boolean.`, node))
    }
  }

  for (const call of calls) {
    if (call.name === null) continue
    const namedArgs = call.args.filter((a) => a.name !== null)
    const duplicate = new Set()
    for (const arg of namedArgs) {
      if (duplicate.has(arg.name)) {
        add(make('error', 'RB3101', `Duplicate named argument '${arg.name}' in ${call.name}().`, arg.nameToken ?? arg.value))
      }
      duplicate.add(arg.name)
    }

    let candidates = []
    let resolvedName = call.name
    if (call.kind === 'identifier') {
      if (userFunctions.has(call.name)) continue
      const entry = resolveEntry(catalog, call.name)
      if (entry !== null) {
        resolvedName = entry.name
        candidates = entry.signatures
      } else if (catalog.constants.has(call.name)) {
        add(make('error', 'RB2102', `'${call.name}' is a constant, not a callable function.`, call.node.callee))
        continue
      } else if (!isKnownCallable(catalog, call.name)) {
        const suggestion = nearestName(call.name, callNames, 2)
        add(make(strictMode ? 'error' : 'warning', 'RB2101', `Unknown RevBayes function '${call.name}'.`, call.node.callee, suggestion === null ? {} : {
          suggestion: `Did you mean '${suggestion}'?`,
          fix: { kind: 'replace', start: call.node.callee.start, end: call.node.callee.end, text: suggestion, safety: 'safe', description: `Replace with '${suggestion}'` },
        }))
        continue
      } else {
        // Language builtin with no catalog signature: nothing more to check.
        continue
      }
    } else if (call.kind === 'member') {
      candidates = methodsFor(catalog, call.name)
      if (candidates.length === 0) continue
    } else {
      continue
    }

    if (candidates.length === 0) continue
    const loose = isLooseSignature(catalog, resolvedName) || call.name !== resolvedName
    if (call.piped === true) {
      const knownNames = new Set(candidates.flatMap((s) => (s.params ?? []).map((p) => p.name).filter(Boolean)))
      for (const arg of namedArgs) {
        if (!knownNames.has(arg.name)) {
          const suggestion = nearestName(arg.name, [...knownNames], 3)
          add(make(loose ? 'warning' : 'warning', 'RB3102', `Unknown argument '${arg.name}' for ${call.name}().`, arg.nameToken ?? arg.value, {
            ...(suggestion === null ? {} : { suggestion: `Did you mean '${suggestion}'?` }),
          }))
        }
      }
      continue
    }
    let fits = candidates.filter((signature) => accepts(signature, call.args))
    let fallbackMatched = false
    if (fits.length === 0) {
      const fallback = candidates.filter((signature) => acceptsRequiredFirst(signature, call.args))
      if (fallback.length > 0) {
        fits = fallback
        fallbackMatched = true
      }
    }
    if (fits.length === 0) {
      const knownNames = new Set(candidates.flatMap((s) => (s.params ?? []).map((p) => p.name).filter(Boolean)))
      let reported = false
      for (const arg of namedArgs) {
        if (!knownNames.has(arg.name)) {
          const suggestion = nearestName(arg.name, [...knownNames], 3)
          // Loose/legacy signatures may accept undocumented argument names, so
          // only a curated set of known mistakes (generation -> generations)
          // is promoted to an error there. On complete signatures a close
          // spelling is high-confidence.
          const knownTypo = HIGH_CONFIDENCE_ARG_TYPOS.get(arg.name) === suggestion
          const closeTypo = suggestion !== null && editDistance(arg.name, suggestion) <= 2
          const severity = knownTypo || strictMode || (!loose && closeTypo) ? 'error' : 'warning'
          add(make(severity, 'RB3102', `Unknown argument '${arg.name}' for ${call.name}().`, arg.nameToken ?? arg.value, {
            ...(suggestion === null ? {} : {
              suggestion: `Did you mean '${suggestion}'?`,
              fix: { kind: 'replace', start: arg.nameToken?.start ?? arg.start, end: arg.nameToken?.end ?? arg.end, text: suggestion, safety: 'safe', description: `Rename to '${suggestion}'` },
            }),
            expected: expectedUsage(candidates),
          }))
          reported = true
        }
      }
      if (!reported) {
        const minRequired = Math.min(...candidates.map((s) => (s.params ?? []).filter((p) => p.required && !p.variadic).length))
        const maxParams = Math.max(...candidates.map((s) => (s.params ?? []).length))
        const positionalCount = call.args.filter((a) => a.name === null).length
        let message
        if (positionalCount > maxParams) message = `${call.name}() received too many arguments (${call.args.length}). Expected ${expectedUsage(candidates)}.`
        else if (positionalCount + namedArgs.length < minRequired) message = `${call.name}() is missing required arguments. Expected ${expectedUsage(candidates)}.`
        else message = `No overload of ${call.name}() accepts these arguments. Expected ${expectedUsage(candidates)}.`
        add(make(loose ? 'warning' : 'error', 'RB3103', message, call.node.callee, { expected: expectedUsage(candidates) }))
      }
      continue
    }

    const signature = fits[0]
    const variadicSignature = (signature.params ?? []).some((p) => p.variadic) || fallbackMatched === true
    if (!variadicSignature) {
      for (let i = 0; i < call.args.length; i += 1) {
        const arg = call.args[i]
        const param = bestParamForArg(signature, call.args, i)
        checkLiteral(call, arg, param, signature, loose)
      }
    } else {
      for (const arg of call.args) {
        if (arg.name === null) continue
        const param = signature.params.find((p) => p.name === arg.name)
        if (param !== undefined) checkLiteral(call, arg, param, signature, loose)
      }
    }
    // A named argument that exists but only in a non-fitting overload is already reported above.
  }

  // ---------- pass 3: MCMC wiring, files, and semantic checks ----------
  if (hasMcmc && !hasMoves) {
    add(make('warning', 'RB4101', 'An mcmc() analysis is constructed but no move is appended (moves.append(...) or moves[i] = ...). The chain cannot sample.', parsed.program, {
      suggestion: 'Add at least one move for every free parameter before constructing the MCMC object.',
    }))
  }
  if (phyloCTMCCalls > 0 && !hasClamp) {
    add(make('warning', 'RB4102', 'dnPhyloCTMC() is used but no .clamp(data) call was found; the observed data would not enter the likelihood.', parsed.program, {
      suggestion: 'Call seq.clamp(data) on the CTMC node.',
    }))
  }
  if (hasMcmc && hasMonitors === false) {
    const declaresMonitors = [...roles.values()].includes('monitors')
    if (declaresMonitors) {
      add(make('info', 'RB4103', 'An mcmc() analysis is constructed but no monitor is appended; no parameter or tree trace will be written.', parsed.program))
    }
  }
  if (hasMcmc && !hasRun) {
    add(make('info', 'RB4104', 'An mcmc() object is created but .run() is never called; the script only builds the analysis.', parsed.program))
  }

  for (const call of calls) {
    if (call.name === 'mcmc' && call.kind === 'identifier' && call.args.length >= 3) {
      const positional = call.args.filter((a) => a.name === null)
      if (positional.length >= 3) {
        const second = rootName(positional[1].value)
        const third = rootName(positional[2].value)
        if (roles.get(second) === 'moves' && roles.get(third) === 'monitors') {
          const secondText = sourceSlice(source, positional[1].value)
          const thirdText = sourceSlice(source, positional[2].value)
          const replacement = `monitors=${thirdText}, moves=${secondText}`
          add(make('warning', 'RB4105', 'mcmc() positional arguments put moves before monitors. The help signature is mcmc(model, monitors, moves, ...); prefer named arguments.', positional[1], {
            suggestion: 'Use named arguments: mcmc(model=..., monitors=monitors, moves=moves).',
            fix: { kind: 'replace', start: positional[1].start, end: positional[2].end, text: replacement, safety: 'review', description: 'Rewrite the last two positional arguments as monitors=..., moves=...' },
          }))
        }
      }
    }
    if (call.kind === 'member' && call.name === 'run' && call.args.length > 0) {
      const genArg = call.args.find((a) => a.name === 'generations' || a.name === 'generation')
      if (genArg?.value?.type === 'number' && genArg.value.value <= 0) {
        add(make('error', 'RB4106', `mcmc.run(generations=...) must be positive, but got ${genArg.value.raw}.`, genArg.value))
      }
    }
  }

  for (const [file, count] of monitorFiles) {
    if (count > 1) {
      add(make('warning', 'RB4107', `The output file ${JSON.stringify(file)} is used by more than one monitor; the monitors will overwrite each other.`, parsed.program, {
        suggestion: 'Give each monitor a distinct filename.',
      }))
    }
  }

  if (checkFiles && baseDir !== null) {
    for (const ref of fileRefs) {
      const target = isAbsolute(ref.path) ? ref.path : resolvePath(baseDir, ref.path)
      let exists = false
      try {
        exists = statSync(target).isFile()
      } catch {
        exists = false
      }
      if (!exists) {
        add(make('warning', 'RB4108', `${ref.call}() references a file that does not exist: ${ref.path}`, ref.node, {
          suggestion: `Create the file or fix the path (resolved to ${target}).`,
        }))
      }
    }
  }

  // ---------- pass 4: undefined variable references ----------
  const bound = new Set([...defined.keys(), ...catalog.constants, ...catalog.callableNames])
  const skipVariableWarnings = hasSource
  const visitExpression = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    switch (node.type) {
      case 'ident':
        if (!bound.has(node.name) && !skipVariableWarnings) {
          const suggestion = nearestName(node.name, [...bound], 2)
          add(make('warning', 'RB2103', `Variable '${node.name}' is used before it is defined in this script.`, node, {
            ...(suggestion === null ? {} : { suggestion: `Did you mean '${suggestion}'?` }),
            note: 'RevBayes may still resolve it from an earlier source() or an interactive session.',
          }))
        }
        break
      case 'call':
        if (node.callee?.type === 'member') visitExpression(node.callee.object)
        else if (node.callee?.type === 'ident') {
          if (!userFunctions.has(node.callee.name) && (defined.has(node.callee.name) || catalog.constants.has(node.callee.name))) {
            // A variable used as a function; unusual but not an unknown name.
          }
        } else visitExpression(node.callee)
        for (const arg of node.args ?? []) visitExpression(arg.value)
        break
      case 'assign':
        if (node.target?.type === 'ident') {
          // target is a definition, not a reference
        } else {
          if (node.target?.type === 'index') {
            visitExpression(node.target.object)
            if (Array.isArray(node.target.indices)) {
              for (const item of node.target.indices) if (item !== null) visitExpression(item)
            } else {
              visitExpression(node.target.index)
            }
          } else {
            visitExpression(node.target)
          }
        }
        visitExpression(node.value)
        break
      case 'binary':
        visitExpression(node.left)
        visitExpression(node.right)
        break
      case 'unary':
        visitExpression(node.argument)
        break
      case 'group':
        visitExpression(node.expression)
        break
      case 'vector':
        for (const item of node.items ?? []) visitExpression(item)
        break
      case 'index':
        visitExpression(node.object)
        if (Array.isArray(node.indices)) {
          for (const item of node.indices) if (item !== null) visitExpression(item)
        } else {
          visitExpression(node.index)
        }
        break
      case 'increment':
        visitExpression(node.argument)
        break
      case 'functionDeclaration':
        visitExpression(node.body)
        break
      case 'member':
        visitExpression(node.object)
        break
      case 'program':
      case 'block':
        for (const statement of node.body ?? []) visitExpression(statement)
        break
      case 'for':
        visitExpression(node.iterable)
        visitExpression(node.body)
        break
      case 'while':
        visitExpression(node.condition)
        visitExpression(node.body)
        break
      case 'if':
        visitExpression(node.condition)
        visitExpression(node.consequent)
        visitExpression(node.alternate)
        break
      case 'return':
        visitExpression(node.value)
        break
      case 'function':
        for (const param of node.params ?? []) visitExpression(param.defaultValue)
        visitExpression(node.body)
        break
      default:
        break
    }
  }
  visitExpression(parsed.program)

  const counts = { error: 0, warning: 0, info: 0 }
  for (const diagnostic of diagnostics) counts[diagnostic.severity] = (counts[diagnostic.severity] ?? 0) + 1
  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column)
  return {
    ok: counts.error === 0,
    diagnostics,
    summary: counts,
    stats: {
      lines: source.split('\n').length,
      bytes: Buffer.byteLength(source, 'utf8'),
      calls: callCount,
      assignments: assignments.length,
      functions: functionCount,
      distinctVariables: defined.size,
      monitorFiles: monitorFiles.size,
    },
    context: {
      hasMcmc,
      hasRun,
      hasMoves,
      hasMonitors,
      hasClamp,
      hasSource,
      phyloCTMCCalls,
    },
  }
}

/**
 * Apply safe fixes from diagnostics.
 * @param {string} source
 * @param {object[]} diagnostics
 * @param {{risky?: boolean}} options
 * @returns {{script: string, applied: object[], skipped: object[]}}
 */
export function applyFixes(source, diagnostics, options = {}) {
  const usable = []
  const skipped = []
  for (const diagnostic of diagnostics) {
    const fix = diagnostic.fix
    if (fix === undefined || fix === null) continue
    if (typeof fix.start !== 'number' || typeof fix.end !== 'number') {
      skipped.push({ ...fix, reason: 'invalid range' })
      continue
    }
    if (fix.safety !== 'safe' && options.risky !== true) {
      skipped.push({ ...fix, reason: 'needs review' })
      continue
    }
    usable.push({ ...fix, code: diagnostic.code, message: diagnostic.message })
  }
  usable.sort((a, b) => b.start - a.start)
  let script = source
  const applied = []
  let lastStart = Number.POSITIVE_INFINITY
  for (const fix of usable) {
    if (fix.end > lastStart) {
      skipped.push({ ...fix, reason: 'overlaps another fix' })
      continue
    }
    script = script.slice(0, fix.start) + fix.text + script.slice(fix.end)
    lastStart = fix.start
    applied.push(fix)
  }
  return { script, applied: applied.reverse(), skipped }
}

export { rootName, sourceSlice }
