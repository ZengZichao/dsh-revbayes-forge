/**
 * Legacy / undocumented RevBayes calls and generic object methods that appear
 * in the tutorial corpus but are absent from help.yml. They are catalog-only
 * supplements: `meta.entries` continues to report the upstream help size while
 * lookups can resolve these names and mark them as legacy.
 */

const fn = (name, usage, description, returnType = 'RevObject', kind = 'function') => ({
  name,
  title: `${name} (legacy)`,
  kinds: [kind],
  typeSpec: [kind === 'function' ? 'Function' : 'Distribution', 'RevObject'],
  returnType,
  signatures: [{
    origin: 'function',
    usage,
    name,
    params: inferParams(usage),
  }],
  methods: [],
  description,
  example: null,
  seeAlso: [],
  aliases: [],
  legacy: true,
})

/** Build optional named parameters from a usage string; argument names are matched by the validator. */
function inferParams(usage) {
  const open = usage.indexOf('(')
  const close = usage.lastIndexOf(')')
  if (open < 0 || close <= open) return []
  const inner = usage.slice(open + 1, close).trim()
  if (inner.length === 0) return []
  return inner.split(',').map((part) => {
    const text = part.trim()
    const eq = text.indexOf('=')
    const head = (eq >= 0 ? text.slice(0, eq) : text).trim().split(/\s+/)
    const name = head.at(-1).replace(/[?[\]]/g, '')
    const variadic = text.includes('...')
    return {
      name,
      type: head.length > 1 ? head[0] : 'RevObject',
      description: null,
      default: eq >= 0 ? text.slice(eq + 1).trim() : null,
      options: null,
      variadic,
      required: false,
    }
  })
}

const FUNCTIONS = [
  fn('rUniform', 'rUniform(min, max, ...)', 'Legacy uniform random-number helper.', 'Real', 'distribution'),
  fn('dnEpisodicFossilizedBirthDeathProcess', 'dnEpisodicFossilizedBirthDeathProcess(lambda, mu, psi, rho, rootAge, taxa, condition)', 'Episodic fossilized birth-death process distribution.', 'Real', 'distribution'),
  fn('dnFBDRMatrix', 'dnFBDRMatrix(taxa, lambda, mu, psi, rho, timeline, k)', 'Fossilized birth-death range matrix distribution.', 'Real', 'distribution'),
  fn('dbinomial', 'dbinomial(n, p, ...)', 'Legacy binomial distribution alias.', 'Real', 'distribution'),
  fn('qexponential', 'qexponential(p, rate, ...)', 'Legacy exponential quantile function.', 'Real', 'distribution'),
  fn('ddirichlet', 'ddirichlet(alpha, ...)', 'Legacy Dirichlet density alias.', 'Real', 'distribution'),
  fn('dnormal', 'dnormal(mean, sd, ...)', 'Legacy normal density alias.', 'Real', 'distribution'),
  fn('qLognormal', 'qLognormal(p, meanlog, sdlog, ...)', 'Legacy lognormal quantile function.', 'Real', 'distribution'),
  fn('qUniform', 'qUniform(p, min, max, ...)', 'Legacy uniform quantile function.', 'Real', 'distribution'),
  fn('qlognormal', 'qlognormal(p, meanlog, sdlog, ...)', 'Legacy lognormal quantile function alias.', 'Real', 'distribution'),
  fn('mvFossilSiteSlideUniform', 'mvFossilSiteSlideUniform(fossil, origin, weight)', 'Legacy fossil-site sliding move.', 'RevObject', 'move'),
  fn('rdirichlet', 'rdirichlet(alpha)', 'Legacy Dirichlet random-number helper.', 'Real[]', 'distribution'),
  fn('rbernoulli', 'rbernoulli(p)', 'Legacy Bernoulli random-number helper.', 'Natural', 'distribution'),
  fn('rCoalescent', 'rCoalescent(...)', 'Legacy coalescent simulation helper.', 'RevObject', 'distribution'),
  fn('dnHeterochronousCoalescent', 'dnHeterochronousCoalescent(...)', 'Legacy heterochronous coalescent distribution.', 'Real', 'distribution'),
  fn('dUniform', 'dUniform(min, max, ...)', 'Legacy uniform density alias.', 'Real', 'distribution'),
  fn('fnPoMoBalance4N', 'fnPoMoBalance4N(...)', 'PoMo balance rate matrix with a 4N population size.', 'RevObject'),
  fn('fnPoMoReversibleMutationRates', 'fnPoMoReversibleMutationRates(...)', 'Reversible PoMo mutation rate matrix.', 'RevObject'),
]

const METHOD_NAMES = [
  ['append', 'Append an element to a vector or moves/monitors container.'],
  ['clamp', 'Clamp a stochastic node to its observed value.'],
  ['setValue', 'Assign a starting value to a stochastic or deterministic node.'],
  ['lnProbability', 'Return the log probability (density) of a node.'],
  ['getIntervalAges', 'Return interval ages from a fossil or stratigraphic range object.'],
  ['clampCharData', 'Clamp a character data object to a CTMC node.'],
  ['normalize', 'Normalize a vector, simplex, or rate matrix in place.'],
  ['getRealPosValues', 'Return positive real values from a parameter vector.'],
  ['numCharacterChanges', 'Count character changes on a character-history object.'],
  ['relativeTimeInStates', 'Return relative time spent in each state.'],
  ['getTimes', 'Return interval or event times from a demographic object.'],
  ['getExpectedAlleleFrequencies', 'Return expected allele frequencies from a StairwayPlot object.'],
  ['getNumberOfEvents', 'Return the number of events in a character history.'],
  ['contains', 'Test whether a container contains a value.'],
  ['characterHistories', 'Return character histories from a CTMC or trace.'],
  ['getAllocationIndex', 'Return the allocation index of a categorical draw.'],
  ['getValue', 'Return the current value of a node.'],
  ['redim', 'Resize a vector or matrix in place.'],
  ['size', 'Return the number of elements in a container (legacy alias of length).'],
  ['length', 'Return the number of elements in a container.'],
  ['rootAge', 'Return the root age of a tree.'],
  ['ntips', 'Return the number of tips in a tree.'],
  ['ntaxa', 'Return the number of taxa in an alignment or tree.'],
  ['taxa', 'Return the taxon set of an alignment or tree.'],
  ['treeLength', 'Return the total tree length.'],
  ['getStateDescriptions', 'Return the state descriptions of a character data object.'],
  ['addVariable', 'Add a variable to a compound move.'],
]

export const LEGACY_FUNCTIONS = Object.freeze(FUNCTIONS)
export const LEGACY_METHOD_NAMES = Object.freeze(METHOD_NAMES.map(([name]) => name))

/**
 * Additional overloads for help entries whose documented signature is
 * incomplete relative to scripts used in the tutorials. They are appended to
 * the upstream entry during catalog loading.
 */
const SIGNATURE_SUPPLEMENTS = {
  dnFBDP: [
    'dnFBDP(origin, lambda, mu, psi, rho, taxa, condition)',
  ],
  dnEpisodicFossilizedBirthDeathProcess: [
    'dnEpisodicFossilizedBirthDeathProcess(lambda, mu, psi, rho, rootAge, taxa, condition)',
  ],
  readTaxonData: [
    'readTaxonData(file, separator)',
  ],
  readDataDelimitedFile: [
    'readDataDelimitedFile(file, header, rownames)',
  ],
  dnPhyloCTMCClado: [
    'dnPhyloCTMCClado(tree, Q, cladoProbs, branchRates, type, nSites)',
  ],
  dnPhyloCTMCDASequence: [
    'dnPhyloCTMCDASequence(tree, Q, branchRates, rootFrequencies, nSites, type)',
  ],
  dnPhyloBrownianREML: [
    'dnPhyloBrownianREML(tree, branchRates)',
  ],
  dnPhyloOrnsteinUhlenbeckREML: [
    'dnPhyloOrnsteinUhlenbeckREML(tree, alpha, theta, sigma, rootStates)',
  ],
  dnPhyloOrnsteinUhlenbeckMVN: [
    'dnPhyloOrnsteinUhlenbeckMVN(tree, alpha, theta, sigma, rootStates)',
  ],
  dnStairwayPlot: [
    'dnStairwayPlot(theta, numSites, numIndividuals, folded, coding)',
  ],
  fnHostSwitchRateModifier: [
    'fnHostSwitchRateModifier(tree, gainScale)',
  ],
  fnRateGeneratorSequence: [
    'fnRateGeneratorSequence(Q, numChars, rateModifiers)',
  ],
  fnChromosomes: [
    'fnChromosomes(max_chromo, gamma, delta, rho)',
  ],
  fnDECRateMatrix: [
    'fnDECRateMatrix(dispersalRates, extirpationRates)',
  ],
  fnDECCladoProbs: [
    'fnDECCladoProbs(eventProbs, eventTypes, numCharacters)',
  ],
  fnCodonHKY: [
    'fnCodonHKY(omega, kappa, pi)',
  ],
  fnFreeBinary: [
    'fnFreeBinary(transition_rates, rescaled)',
  ],
  fnFreeK: [
    'fnFreeK(transition_rates, rescaled)',
  ],
  dnMultiSpeciesCoalescentInverseGamma: [
    'dnMultiSpeciesCoalescentInverseGamma(speciesTree, shape, rate, taxa)',
  ],
}

export function signatureSupplements() {
  const out = {}
  for (const [name, usages] of Object.entries(SIGNATURE_SUPPLEMENTS)) {
    out[name] = usages.map((usage) => ({
      origin: 'legacy-overload',
      usage,
      name,
      params: inferParams(usage).map((param) => ({ ...param, required: false })),
      legacy: true,
    }))
  }
  return out
}

export function legacyFunctionEntries() {
  return Object.fromEntries(FUNCTIONS.map((entry) => [entry.name, entry]))
}

export function legacyMethodEntries() {
  const entries = {}
  for (const [name, description] of METHOD_NAMES) {
    entries[name] = {
      name,
      title: `${name} (legacy method)`,
      kinds: ['method'],
      typeSpec: ['Method', 'RevObject'],
      returnType: 'RevObject',
      signatures: [],
      methods: [{
        name,
        usage: `${name}(...)`,
        description,
        params: [{ name: 'args', type: 'RevObject', description: null, default: null, options: null, variadic: true, required: false }],
      }],
      description,
      example: null,
      seeAlso: [],
      aliases: [],
      legacy: true,
    }
  }
  return entries
}
