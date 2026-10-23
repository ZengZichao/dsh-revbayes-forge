/**
 * RevBayes signature catalog.
 *
 * The bundled JSON is generated from RevBayes' own help database
 * (`revbayes.github.io-source/_data/help.yml`), which is the same source the
 * RevBayes website uses for its function reference. It carries 600+ entries,
 * 650+ call signatures, and 450+ methods, including default values and enum
 * options.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { legacyFunctionEntries, legacyMethodEntries, signatureSupplements } from '../data/legacy-catalog.js'

const BUNDLED_PATH = fileURLToPath(new URL('../data/revbayes-signatures.json', import.meta.url))

/** Calls the Rev language itself provides that are not RevBayes help entries. */
const LANGUAGE_CALLS = new Set([
  'c', 'seq', 'rep', 'length', 'size', 'dim', 'names', 'matrix', 'array',
  'print', 'cat', 'paste', 'format', 'sprintf', 'error', 'assert', 'stop', 'warning',
  'type', 'typeof', 'class', 'exists', 'getOption', 'setOption', 'system',
  'abs', 'exp', 'ln', 'log', 'log10', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'floor', 'ceil', 'round', 'trunc', 'min', 'max', 'sum', 'prod', 'mean', 'median', 'sd', 'var',
  'range', 'sort', 'unique', 'reverse', 'str', 'substr', 'nchar', 'toupper', 'tolower',
  'ifelse', 'isNull', 'isFinite', 'isNaN', 'isInteger', 'isReal', 'isString', 'isBool', 'choose', 'factorial', 'beta', 'gamma', 'lgamma',
  'dbeta', 'dbinom', 'dcauchy', 'dchisq', 'dexp', 'dgamma', 'dgeom', 'dlnorm', 'dlogis',
  'dnbinom', 'dnorm', 'dpois', 'dt', 'dunif', 'dweibull',
  'pbeta', 'pbinom', 'pcauchy', 'pchisq', 'pexp', 'pgamma', 'pgeom', 'plnorm', 'plogis',
  'pnbinom', 'pnorm', 'ppois', 'pt', 'punif', 'pweibull',
  'qbeta', 'qbinom', 'qcauchy', 'qchisq', 'qexp', 'qgamma', 'qgeom', 'qlnorm', 'qlogis',
  'qnbinom', 'qnorm', 'qpois', 'qt', 'qunif', 'qweibull',
  'rbeta', 'rbinom', 'rcauchy', 'rchisq', 'rexp', 'rgamma', 'rgeom', 'rlnorm', 'rlogis',
  'rnbinom', 'rnorm', 'rpois', 'rt', 'runif', 'rweibull',
  'range', 'diag', 't', 'solve', 'inverse', 'eigen', 'rep', 'rownames', 'colnames',
])

/** Built-in constants / environment values. */
const LANGUAGE_CONSTANTS = new Set(['TRUE', 'FALSE', 'NULL', 'NA', 'NaN', 'Inf', 'PI', 'pi', 'E', 'true', 'false', 'null'])

/**
 * Signatures that are known to be incomplete in the help database (for
 * example `sum` documents only the matrix overload while RevBayes also accepts
 * vectors). Their names are still checked, but arity/type checks are softened
 * to warnings to avoid false positives.
 */
const LOOSE_SIGNATURE_NAMES = new Set([
  'sum', 'min', 'max', 'mean', 'median', 'sd', 'var', 'prod', 'range', 'sort', 'unique',
  'rep', 'seq', 'c', 'v', 'matrix', 'print', 'write', 'paste', 'format', 'sprintf', 'str',
  'ifelse', 'abs', 'exp', 'ln', 'log', 'sqrt', 'pow', 'round', 'floor', 'ceil', 'trunc',
  'clade', 'dnPhyloCTMC', 'readDiscreteCharacterData', 'readTrees', 'readTreeTrace',
  'readDelimitedDataFile', 'readDataDelimitedFile', 'dnFBDP', 'mvFossilTipTimeSlideUniform',
  'writeDelimitedCharacterData', 'writeNexus', 'write',
  'mapTree', 'get', 'steppingStoneSampler', 'pathSampler', 'srMinESS',
  'fnChromosomesCladoEventsBD', 'mvFossilTipTimeUniform', 'mvFossilTipTimeSlideUniform',
  'readTaxonData', 'readAncestralStateTrace', 'ConditionalPosteriorOrdinate', 'loadPlugin',
  'dnEpisodicFossilizedBirthDeathProcess', 'dnFBDRMatrix', 'dnFBDP',
  'readMatrix', 'readStochasticVariableTrace', 'readRelativeNodeAgeConstraints',
  'readAncestralStateTreeTrace', 'summarizeCharacterMaps', 'ancestralStateTree',
  'dnPhyloOrnsteinUhlenbeckMVN', 'dnPhyloMultiSampleOrnsteinUhlenbeckREML',
  'dnPhyloOrnsteinUhlenbeckPruning', 'fnFreeK', 'initializeFromCheckpoint',
  'dnCDBDP', 'reroot', 'concatenate', 'run', 'dnSoftBoundUniformNormal',
  'mvCorrelationMatrixSpecificElementBeta', 'mvCorrelationMatrixUpdate',
  'dnUniformTopologyBranchLength', 'readDataDelimitedFile', 'fnPoMoKN',
  'dnBDSTP', 'dnBDSTPBurst', 'dnCDBDP', 'dnBDP', 'dnFBDRMatrix',
])

/** Levenshtein edit distance for typo suggestions. */
export function editDistance(a, b) {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

/** Return the closest candidate within `maxDistance`, or null. */
export function nearestName(name, candidates, maxDistance = 2) {
  let best = null
  let bestDistance = maxDistance + 1
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return bestDistance <= maxDistance ? best : null
}

function buildIndexes(data) {
  const entries = data.entries ?? {}
  const aliases = data.aliases ?? {}
  const methods = new Map()
  const callableNames = new Set()
  const typeOwners = new Map()

  for (const entry of Object.values(entries)) {
    callableNames.add(entry.name)
    for (const alias of entry.aliases ?? []) callableNames.add(alias)
    for (const signature of entry.signatures ?? []) {
      callableNames.add(signature.name)
    }
    for (const method of entry.methods ?? []) {
      const list = methods.get(method.name) ?? []
      list.push(method)
      methods.set(method.name, list)
      callableNames.add(method.name)
    }
    const primaryType = entry.typeSpec?.find((t) => !['Function', 'RevObject', 'WorkspaceObject', 'WorkspaceToCoreWrapperObject'].includes(t))
    if (primaryType !== undefined) {
      const list = typeOwners.get(primaryType) ?? []
      list.push(entry.name)
      typeOwners.set(primaryType, list)
    }
  }
  for (const name of LANGUAGE_CALLS) callableNames.add(name)
  const loose = new Set(LOOSE_SIGNATURE_NAMES)
  for (const name of Object.keys(legacyFunctionEntries())) loose.add(name)
  for (const name of Object.keys(legacyMethodEntries())) loose.add(name)

  return {
    entries,
    aliases,
    methods,
    callableNames,
    typeOwners,
    constants: LANGUAGE_CONSTANTS,
    loose,
    meta: data.meta ?? {},
  }
}

let cachedBundled = null

/** Load the catalog from the bundled JSON or an explicit override path. */
export function loadCatalog(path = null) {
  if (path === null && cachedBundled !== null) return cachedBundled
  const raw = readFileSync(path ?? BUNDLED_PATH, 'utf8')
  const data = JSON.parse(raw)
  if (path === null) {
    const legacyFunctions = legacyFunctionEntries()
    const legacyMethods = legacyMethodEntries()
    data.entries = { ...data.entries, ...legacyFunctions, ...legacyMethods }
    for (const [name, signatures] of Object.entries(signatureSupplements())) {
      const canonical = data.entries[name] === undefined ? data.aliases[name] : name
      const entry = canonical === undefined ? null : data.entries[canonical]
      if (entry === undefined || entry === null) continue
      const known = new Set(entry.signatures.map((signature) => signature.usage))
      for (const signature of signatures) if (!known.has(signature.usage)) entry.signatures.push(signature)
    }
    data.meta = {
      ...data.meta,
      legacyFunctions: Object.keys(legacyFunctions).length,
      legacyMethods: Object.keys(legacyMethods).length,
      totalEntries: Object.keys(data.entries).length,
    }
  }
  const catalog = buildIndexes(data)
  catalog.legacy = new Set([
    ...Object.keys(legacyFunctionEntries()),
    ...Object.keys(legacyMethodEntries()),
  ])
  if (path === null) cachedBundled = catalog
  return catalog
}

/** Resolve an alias to its canonical entry. */
export function resolveEntry(catalog, name) {
  return catalog.entries[name] ?? catalog.entries[catalog.aliases[name]] ?? null
}

/** All signature candidates for an identifier call (aliases included). */
export function signaturesFor(catalog, name) {
  const entry = resolveEntry(catalog, name)
  if (entry !== null && entry.signatures.length > 0) return entry.signatures
  if (entry !== null) return []
  return catalog.methods.get(name) ?? []
}

/** Method candidates by name; used for dotted calls. */
export function methodsFor(catalog, name) {
  return catalog.methods.get(name) ?? []
}

/** Whether a name is callable at all. */
export function isKnownCallable(catalog, name) {
  return catalog.callableNames.has(name) || catalog.constants.has(name)
}

/** Names that may be referenced without assignment. */
export function isLanguageConstant(catalog, name) {
  return catalog.constants.has(name)
}

/** Soften signature diagnostics for entries with incomplete help metadata. */
export function isLooseSignature(catalog, name) {
  return catalog.loose.has(name)
}

/** Look up one entry by exact name or alias. */
export function lookupEntry(catalog, name) {
  const canonical = catalog.entries[name] ? name : catalog.aliases[name]
  if (canonical === undefined) return null
  const entry = catalog.entries[canonical]
  return entry === undefined ? null : { ...entry, canonicalName: canonical }
}

/**
 * Search entries by name, alias, title, description, category, and see-also.
 * Exact and prefix matches come first; descriptions last.
 */
export function searchCatalog(catalog, query, options = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50))
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle.length === 0) return []
  const kind = options.kind ?? 'any'
  const scored = []
  for (const entry of Object.values(catalog.entries)) {
    if (kind !== 'any') {
      if (kind === 'function' && !entry.kinds.includes('function')) continue
      if (kind === 'constructor' && entry.kinds.includes('function')) continue
      if (kind === 'distribution' && !entry.kinds.includes('distribution')) continue
      if (kind === 'move' && !entry.kinds.includes('move')) continue
      if (kind === 'monitor' && !entry.kinds.includes('monitor')) continue
      if (kind === 'method' && entry.methods.length === 0) continue
    }
    const name = entry.name.toLowerCase()
    const aliases = (entry.aliases ?? []).map((a) => a.toLowerCase())
    const title = (entry.title ?? '').toLowerCase()
    const description = (entry.description ?? '').toLowerCase()
    let score = 0
    if (name === needle) score = 1000
    else if (aliases.includes(needle)) score = 950
    else if (name.startsWith(needle)) score = 800 - name.length
    else if (name.includes(needle)) score = 600 - name.length
    else if (title.includes(needle)) score = 400
    else if (aliases.some((a) => a.includes(needle))) score = 350
    else if (description.includes(needle)) score = 100
    else if ((entry.seeAlso ?? []).some((s) => s.toLowerCase() === needle)) score = 50
    if (kind === 'method') {
      const methodHit = entry.methods.some((m) => m.name.toLowerCase().includes(needle))
      if (methodHit) score = Math.max(score, 700)
    }
    if (score > 0) scored.push({ entry, score })
  }
  if (scored.length === 0 && /\s/.test(needle)) {
    const words = needle.split(/\s+/).filter((w) => w.length > 1)
    for (const entry of Object.values(catalog.entries)) {
      if (kind !== 'any') {
        if (kind === 'function' && !entry.kinds.includes('function')) continue
        if (kind === 'constructor' && entry.kinds.includes('function')) continue
        if (kind === 'distribution' && !entry.kinds.includes('distribution')) continue
        if (kind === 'move' && !entry.kinds.includes('move')) continue
        if (kind === 'monitor' && !entry.kinds.includes('monitor')) continue
        if (kind === 'method' && entry.methods.length === 0) continue
      }
      const haystack = `${entry.name} ${entry.title ?? ''} ${(entry.aliases ?? []).join(' ')} ${entry.description ?? ''} ${(entry.seeAlso ?? []).join(' ')}`.toLowerCase()
      const hits = words.filter((word) => haystack.includes(word)).length
      if (hits > 0) scored.push({ entry, score: hits * 50 })
    }
  }
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
  return scored.slice(0, limit).map(({ entry }) => entry)
}

/** Human-readable signature list for an entry. */
export function entrySignatures(entry) {
  const signatures = [...(entry.signatures ?? [])]
  for (const method of entry.methods ?? []) signatures.push({ ...method, usage: `${entry.name}.${method.name}${method.usage.slice(method.usage.indexOf('('))}` })
  return signatures
}
