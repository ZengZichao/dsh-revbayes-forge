/**
 * pack-continuous-traits — Brownian motion, Ornstein-Uhlenbeck, relaxed BM,
 * and multivariate trait evolution on a time tree.
 */
import {
  definePack,
  buildPackScript,
  normalizeBaseSpec,
  normalizeMcmc,
  mcmcTail,
  section,
  renderSections,
  asString,
  asNumber,
  asInteger,
  asObject,
  optionalObject,
  PackSpecError,
} from '../spec.js'

const SOURCE = 'pack:continuous-traits'
const ANALYSES = ['bm', 'ou', 'relaxed_bm', 'multivariate']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'traits',
    code: 'TRA1001',
    analyses: ANALYSES,
    defaultAnalysis: 'bm',
  })
  const data = base.data
  const treeFile = asString(spec.tree?.file, 'tree.file', { code: 'TRA1002', required: true })
  const trait = asInteger(data.trait, 'data.trait', { code: 'TRA1003', defaultValue: 1, min: 1, max: 1000 })
  const sigma2 = asNumber(spec.model?.sigma2, 'model.sigma2', { code: 'TRA1004', defaultValue: 0.1, min: 0, exclusiveMin: true })
  const alpha = asNumber(spec.model?.alpha, 'model.alpha', { code: 'TRA1005', defaultValue: 1.0, min: 0, exclusiveMin: true })
  const theta = asNumber(spec.model?.theta, 'model.theta', { code: 'TRA1006', defaultValue: 0.0 })
  const dimensions = asInteger(spec.model?.dimensions, 'model.dimensions', { code: 'TRA1007', defaultValue: 2, min: 2, max: 100 })
  const rootStates = Array.isArray(spec.model?.root_states)
    ? spec.model.root_states.map((value, index) => asNumber(value, `model.root_states[${index}]`, { code: 'TRA1008' }))
    : null
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'TRA1009', defaultGenerations: 30000 })
  return { ...base, treeFile, trait, sigma2, alpha, theta, dimensions, rootStates, mcmc }
}

function preamble(spec) {
  return [
    `T <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
    `data <- readContinuousCharacterData(${JSON.stringify(spec.file)})`,
    'data.excludeAll()',
    `data.includeCharacter(${spec.trait})`,
    'taxa <- data.taxa()',
    'num_taxa <- data.ntaxa()',
    'num_branches <- 2 * num_taxa - 2',
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
    '',
    'tree <- T',
  ]
}

function renderBM(spec, relaxed = false) {
  const lines = [
    `sigma2 ~ dnLoguniform(1e-5, ${Math.max(0.01, spec.sigma2 * 10)})`,
    'moves.append( mvScale(sigma2, weight=1.0) )',
  ]
  if (relaxed) {
    lines.push(
      '# Each branch gets its own rate multiplier',
      'for (i in 1:num_branches) {',
      '    branch_sigma[i] ~ dnLognormal(ln(sqrt(sigma2)), 0.5)',
      '    moves.append( mvScale(branch_sigma[i], weight=1.0) )',
      '}',
      'X ~ dnPhyloBrownianREML(tree, branchRates=branch_sigma)',
    )
  } else {
    lines.push('X ~ dnPhyloBrownianREML(tree, branchRates=sqrt(sigma2))')
  }
  lines.push('X.clamp(data)')
  const sections = [
    section('Reading the Tree and Traits', 100, preamble(spec)),
    section('Brownian Motion Model', 200, lines),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'sigma2', treeName: null, extraScreen: ['sigma2'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: `traits/${spec.analysis}`, dataFile: spec.file, title: 'Continuous trait evolution', sections })
}

function renderOU(spec) {
  const lines = [
    `alpha ~ dnUniform(0.0, ${Math.max(1, spec.alpha * 5)})`,
    `theta ~ dnNormal(${spec.theta}, 10.0)`,
    `sigma2 ~ dnLoguniform(1e-5, ${Math.max(0.01, spec.sigma2 * 10)})`,
    'moves.append( mvScale(alpha, weight=2) )',
    'moves.append( mvSlide(theta, weight=2) )',
    'moves.append( mvScale(sigma2, weight=2) )',
    `root_states <- ${spec.rootStates === null ? 'v(0.0)' : `v(${spec.rootStates.join(', ')})`}`,
    'X ~ dnPhyloOrnsteinUhlenbeckREML(tree, alpha, theta, sqrt(sigma2), root_states)',
    'X.clamp(data)',
  ]
  const sections = [
    section('Reading the Tree and Traits', 100, preamble(spec)),
    section('Ornstein-Uhlenbeck Model', 200, lines),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'alpha', treeName: null,
      extraScreen: ['alpha', 'theta', 'sigma2'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: 'traits/ou', dataFile: spec.file, title: 'Ornstein-Uhlenbeck trait evolution', sections })
}

function renderMultivariate(spec) {
  const rootStates = spec.rootStates === null
    ? `rep(0.0, ${spec.dimensions})`
    : `v(${spec.rootStates.join(', ')})`
  const lines = [
    `sigma2 ~ dnLoguniform(1e-5, ${Math.max(0.01, spec.sigma2 * 10)})`,
    'moves.append( mvScale(sigma2, weight=1.0) )',
    `root_states <- ${rootStates}`,
    'X ~ dnPhyloBrownianMVN(tree, branchRates=sqrt(sigma2), rootStates=root_states)',
    'X.clamp(data)',
  ]
  const sections = [
    section('Reading the Tree and Multivariate Traits', 100, preamble(spec)),
    section('Multivariate Brownian Motion', 200, lines),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'sigma2', treeName: null, extraScreen: ['sigma2'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: 'traits/multivariate', dataFile: spec.file, title: 'Multivariate Brownian motion', sections })
}

export const manifest = definePack({
  id: 'continuous-traits',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'verified',
  title: 'Continuous Traits',
  description: 'Brownian motion, Ornstein-Uhlenbeck, relaxed Brownian motion, and multivariate trait models.',
  analyses: [
    { id: 'bm', title: 'Brownian motion', maturity: 'verified' },
    { id: 'ou', title: 'Ornstein-Uhlenbeck', maturity: 'verified' },
    { id: 'relaxed_bm', title: 'Relaxed BM', maturity: 'golden' },
    { id: 'multivariate', title: 'Multivariate BM', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_generate_traits',
    description: 'Generate a continuous-trait analysis (BM, OU, relaxed BM, or multivariate BM) from a structured spec.',
    specDescription: 'Trait spec with a time tree, continuous character data, model parameters, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Trait model variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Continuous character data.', properties: { file: { type: 'string' }, trait: { type: 'number' } } },
      tree: { type: 'object', description: 'Time tree.', properties: { file: { type: 'string' } } },
      model: { type: 'object', description: 'Trait model parameters.', properties: { sigma2: { type: 'number' }, alpha: { type: 'number' }, theta: { type: 'number' }, dimensions: { type: 'number' }, root_states: { type: 'array', items: { type: 'number' } } } },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.continuous', 'tree.time', 'traits.bm', 'traits.ou', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => {
        if (normalized.analysis === 'ou') return renderOU(normalized)
        if (normalized.analysis === 'multivariate') return renderMultivariate(normalized)
        return renderBM(normalized, normalized.analysis === 'relaxed_bm')
      },
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/traits'] },
})

export default manifest
