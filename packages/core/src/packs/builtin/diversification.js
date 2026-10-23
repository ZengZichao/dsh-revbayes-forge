/**
 * pack-diversification — constant-rate birth-death, BiSSE/HiSSE/ClaSSE
 * state-dependent diversification.
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

const SOURCE = 'pack:diversification'
const ANALYSES = ['birthdeath', 'sse', 'hisse', 'classe']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'diversification',
    code: 'DIV1001',
    analyses: ANALYSES,
    defaultAnalysis: 'birthdeath',
    requireDataFile: false,
  })
  const data = optionalObject(spec.data, 'data', 'DIV1002')
  const treeFile = asString(data.tree ?? spec.tree?.file, 'data.tree', { code: 'DIV1003', required: true })
  const statesFile = asString(data.states_file, 'data.states_file', { code: 'DIV1004', required: base.analysis !== 'birthdeath' })
  const numStates = asInteger(data.num_states, 'data.num_states', { code: 'DIV1005', defaultValue: 2, min: 2, max: 64 })
  if (base.analysis !== 'birthdeath' && numStates < 2) throw new PackSpecError('DIV1006', 'num_states must be at least 2 for state-dependent models.', 'data.num_states')
  const model = optionalObject(spec.model, 'model', 'DIV1007')
  const sampling = asNumber(model.sampling, 'model.sampling', { code: 'DIV1008', defaultValue: 1.0, min: 0, max: 1 })
  const birth = asNumber(model.birth_rate, 'model.birth_rate', { code: 'DIV1009', defaultValue: 0.1, min: 0, exclusiveMin: true })
  const death = asNumber(model.death_rate, 'model.death_rate', { code: 'DIV1010', defaultValue: 0.01, min: 0 })
  if (death >= birth) throw new PackSpecError('DIV1011', 'model.death_rate must be smaller than model.birth_rate.', 'model.death_rate')
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'DIV1012', defaultGenerations: 30000 })
  return { ...base, treeFile, statesFile, numStates, sampling, birth, death, mcmc }
}

function renderBirthDeath(spec) {
  const sections = [
    section('Reading the Time Tree', 100, [
      `T <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
      'taxa <- T.taxa()',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
    ]),
    section('Birth-Death Model', 200, [
      `birth_rate ~ dnUniform(0, ${Math.max(1, spec.birth * 10)})`,
      `death_rate ~ dnUniform(0, ${Math.max(0.5, spec.death * 10)})`,
      'moves.append( mvScale(birth_rate, lambda=1.0, tune=true, weight=3.0) )',
      'moves.append( mvScale(death_rate, lambda=1.0, tune=true, weight=3.0) )',
      'diversification := birth_rate - death_rate',
      'rel_extinction  := death_rate / birth_rate',
      `rho <- ${spec.sampling}`,
      'root_time <- T.rootAge()',
      'timetree ~ dnBDP(lambda=birth_rate, mu=death_rate, rho=rho, rootAge=root_time, samplingStrategy="uniform", condition="survival", taxa=taxa)',
      'timetree.clamp(T)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'birth_rate', treeName: 'timetree',
      extraScreen: ['birth_rate', 'death_rate', 'diversification'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: 'diversification/birthdeath', dataFile: spec.treeFile, title: 'Constant-rate birth-death analysis', sections })
}

function renderSSE(spec) {
  const numStates = spec.numStates
  const hidden = spec.analysis === 'hisse' ? numStates * 2 : numStates
  const feature = spec.analysis === 'classe' ? 2 : 1
  const lines = [
    `NUM_STATES = ${numStates}`,
    `observed_phylogeny <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
    `data_states <- readDiscreteCharacterData(${JSON.stringify(spec.statesFile)})`,
    'num_taxa <- observed_phylogeny.ntips()',
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
    `NUM_HIDDEN_STATES = ${hidden}`,
    `NUM_FEATURES = ${feature}`,
  ]
  const rateLines = []
  rateLines.push(`for (i in 1:NUM_STATES) {`)
  rateLines.push('    speciation[i] ~ dnLoguniform( 1E-6, 1E2)')
  rateLines.push('    moves.append( mvScale(speciation[i], lambda=0.20, tune=true, weight=3.0) )')
  rateLines.push('    extinction[i] ~ dnLoguniform( 1E-6, 1E2)')
  rateLines.push('    moves.append( mvScale(extinction[i], lambda=0.20, tune=true, weight=3.0) )')
  rateLines.push('    diversification[i] := speciation[i] - extinction[i]')
  rateLines.push('}')
  rateLines.push(`rate_pr := observed_phylogeny.treeLength() / 10`)
  rateLines.push(`for ( i in 1:(NUM_STATES*(NUM_STATES-1)) ) {`)
  rateLines.push('    transition_rates[i] ~ dnExp(rate_pr)')
  rateLines.push('    moves.append( mvScale(transition_rates[i], lambda=0.20, tune=true, weight=3.0) )')
  rateLines.push('}')
  rateLines.push('rate_matrix := fnFreeBinary( transition_rates, rescaled=false)')
  rateLines.push('root_state_freq ~ dnDirichlet( rep(1,NUM_STATES) )')
  rateLines.push('moves.append( mvDirichletSimplex(root_state_freq, tune=true, weight=2) )')
  rateLines.push('root_age <- observed_phylogeny.rootAge()')
  rateLines.push(`sampling <- ${spec.sampling}`)
  rateLines.push('timetree ~ dnCDBDP( rootAge=root_age, speciationRates=speciation, extinctionRates=extinction, Q=rate_matrix, pi=root_state_freq, delta=1.0, rho=sampling, condition="time")')
  rateLines.push('timetree.clamp(observed_phylogeny)')

  const sections = [
    section('Reading the Tree and Character States', 100, lines),
    section('State-Dependent Diversification Rates', 200, rateLines),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'timetree', treeName: 'timetree',
      extraScreen: ['speciation', 'extinction'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: `diversification/${spec.analysis}`, dataFile: spec.statesFile, title: 'State-dependent diversification (SSE) analysis', sections })
}

export const manifest = definePack({
  id: 'diversification',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'verified',
  title: 'Diversification and SSE',
  description: 'Constant-rate birth-death and state-dependent BiSSE/HiSSE/ClaSSE diversification models.',
  analyses: [
    { id: 'birthdeath', title: 'Birth-death', maturity: 'verified' },
    { id: 'sse', title: 'BiSSE/SSE', maturity: 'verified' },
    { id: 'hisse', title: 'HiSSE', maturity: 'golden' },
    { id: 'classe', title: 'ClaSSE', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_generate_diversification',
    description: 'Generate a birth-death or state-dependent diversification analysis from a structured spec.',
    specDescription: 'Diversification spec with a time tree, optional state data, model rates, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Diversification analysis variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Tree and state data.', properties: { tree: { type: 'string' }, states_file: { type: 'string' }, num_states: { type: 'number' } } },
      tree: { type: 'object', description: 'Time tree.', properties: { file: { type: 'string' } } },
      model: { type: 'object', description: 'Diversification rates.', properties: { birth_rate: { type: 'number' }, death_rate: { type: 'number' }, sampling: { type: 'number' } } },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.states', 'tree.birthdeath', 'diversification.sse', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => (normalized.analysis === 'birthdeath' ? renderBirthDeath(normalized) : renderSSE(normalized)),
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/diversification'] },
})

export default manifest
