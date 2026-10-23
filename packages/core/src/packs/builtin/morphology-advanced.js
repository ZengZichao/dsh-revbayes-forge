/**
 * pack-morphology-advanced — Mkv (variable coding), ancestral state
 * reconstruction, and stochastic character mapping.
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
  asInteger,
  asNumber,
  asObject,
  optionalObject,
} from '../spec.js'

const SOURCE = 'pack:morphology-advanced'
const ANALYSES = ['mkv', 'ancestral_state', 'stochastic_map']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'morphology',
    code: 'MOR1001',
    analyses: ANALYSES,
    defaultAnalysis: 'mkv',
  })
  const data = base.data
  const stateCount = asInteger(data.state_count, 'data.state_count', { code: 'MOR1002', defaultValue: 2, min: 2, max: 64 })
  const treeFile = asString(spec.tree?.file, 'tree.file', { code: 'MOR1003', required: true })
  const treeType = asString(spec.tree?.type, 'tree.type', { code: 'MOR1004', defaultValue: 'time', enumValues: ['time', 'non-clock'] })
  const gamma = asObject(spec.substitution?.gamma ?? {}, 'substitution.gamma', 'MOR1005')
  const gammaCategories = asInteger(gamma.categories, 'substitution.gamma.categories', { code: 'MOR1006', defaultValue: 4, min: 2, max: 20 })
  const useGamma = spec.substitution?.gamma !== undefined
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'MOR1007', defaultGenerations: 20000 })
  return { ...base, stateCount, treeFile, treeType, gammaCategories, useGamma, mcmc }
}

function dataAndTree(spec) {
  return [
    `morpho <- readDiscreteCharacterData(${JSON.stringify(spec.file)})`,
    'taxa <- morpho.taxa()',
    'num_taxa <- morpho.ntaxa()',
    'num_branches <- 2 * num_taxa - 3',
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
    '',
    spec.treeType === 'time'
      ? `tree <- readTrees(${JSON.stringify(spec.treeFile)})[1]`
      : `tree <- readTrees(${JSON.stringify(spec.treeFile)}, treetype="non-clock")[1]`,
  ]
}

function substitution(spec, variableCoding) {
  const lines = [`Q <- fnJC(${spec.stateCount})`]
  if (spec.useGamma) {
    lines.push('alpha ~ dnExponential(1.0)', 'moves.append( mvScale(alpha, weight=5.0) )', `site_rates := fnDiscretizeGamma(alpha, alpha, ${spec.gammaCategories})`)
  }
  return lines
}

function renderMkv(spec) {
  const sections = [
    section('Reading Morphology and Tree', 100, dataAndTree(spec)),
    section('Mkv Substitution Model', 200, [
      ...substitution(spec, true),
      'clock_rate ~ dnExponential(1.0)',
      'moves.append( mvScale(clock_rate, weight=4.0) )',
      '',
      `seq ~ dnPhyloCTMC(tree=tree, Q=Q, branchRates=clock_rate, ${spec.useGamma ? 'siteRates=site_rates, ' : ''}type="Standard", coding="variable")`,
      'seq.clamp(morpho)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'seq', treeName: null,
      extraScreen: ['clock_rate'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: 'morphology/mkv', dataFile: spec.file, title: 'Mkv morphological analysis', sections })
}

function renderASR(spec) {
  const sections = [
    section('Reading Morphology and Tree', 100, dataAndTree(spec)),
    section('Morphological CTMC', 200, [
      ...substitution(spec, false),
      'clock_rate ~ dnExponential(1.0)',
      'moves.append( mvScale(clock_rate, weight=4.0) )',
      '',
      `seq ~ dnPhyloCTMC(tree=tree, Q=Q, branchRates=clock_rate, ${spec.useGamma ? 'siteRates=site_rates, ' : ''}type="Standard")`,
      'seq.clamp(morpho)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'seq', treeName: 'tree',
      extraMonitors: [
        `mnJointConditionalAncestralState(tree=tree, ctmc=seq, type="Standard", withTips=true, withStartStates=true, filename="${spec.mcmc.outputDir}/${spec.name}.anc_states.log", printgen=${spec.mcmc.sampleEvery})`,
      ],
      extraScreen: ['clock_rate'],
    })),
    section('Ancestral State Summary', 950, [
      `anc_state_trace = readAncestralStateTrace("${spec.mcmc.outputDir}/${spec.name}.anc_states.log")`,
      `ancestralStateTree(tree, anc_state_trace, "${spec.mcmc.outputDir}/${spec.name}_ancestral.tree", burnin=0.25, reconstruction="marginal")`,
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'morphology/ancestral_state', dataFile: spec.file, title: 'Morphological ancestral state reconstruction', sections })
}

function renderStochasticMap(spec) {
  const sections = [
    section('Reading Morphology and Tree', 100, dataAndTree(spec)),
    section('Morphological CTMC', 200, [
      ...substitution(spec, false),
      'clock_rate ~ dnExponential(1.0)',
      'moves.append( mvScale(clock_rate, weight=4.0) )',
      '',
      `seq ~ dnPhyloCTMC(tree=tree, Q=Q, branchRates=clock_rate, ${spec.useGamma ? 'siteRates=site_rates, ' : ''}type="Standard")`,
      'seq.clamp(morpho)',
      'moves.append( mvCharacterHistory(ctmc=seq, qmap_site=Q, lambda=0.2, graph="branch", proposal="rejection", weight=num_branches) )',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'seq', treeName: 'tree',
      extraMonitors: [
        `mnStochasticCharacterMap(ctmc=seq, filename="${spec.mcmc.outputDir}/${spec.name}.stoch.log", printgen=${spec.mcmc.sampleEvery})`,
      ],
      extraScreen: ['clock_rate'],
    })),
    section('Character Map Summary', 950, [
      `char_map_trace = readAncestralStateTrace("${spec.mcmc.outputDir}/${spec.name}.stoch.log")`,
      `summarizeCharacterMaps(tree, char_map_trace, "${spec.mcmc.outputDir}/${spec.name}_char_map.tree", burnin=0.25)`,
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'morphology/stochastic_map', dataFile: spec.file, title: 'Stochastic character mapping', sections })
}

export const manifest = definePack({
  id: 'morphology-advanced',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'golden',
  title: 'Advanced Morphology',
  description: 'Mkv variable-coding analyses, morphological ancestral state reconstruction, and stochastic character mapping.',
  analyses: [
    { id: 'mkv', title: 'Mkv', maturity: 'golden' },
    { id: 'ancestral_state', title: 'Ancestral state', maturity: 'golden' },
    { id: 'stochastic_map', title: 'Stochastic map', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_generate_morphology',
    description: 'Generate an Mkv, ancestral-state, or stochastic-character-map analysis from a structured spec.',
    specDescription: 'Morphology spec with a character matrix, tree, state count, optional gamma, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Morphology analysis variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Morphological matrix.', properties: { file: { type: 'string' }, state_count: { type: 'number' } } },
      tree: { type: 'object', description: 'Tree file and type.', properties: { file: { type: 'string' }, type: { type: 'string', enum: ['time', 'non-clock'] } } },
      substitution: { type: 'object', description: 'Rate variation.', properties: { gamma: { type: 'object', properties: { categories: { type: 'number' } } } } },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.character', 'substitution.morph', 'asr', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => {
        if (normalized.analysis === 'ancestral_state') return renderASR(normalized)
        if (normalized.analysis === 'stochastic_map') return renderStochasticMap(normalized)
        return renderMkv(normalized)
      },
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/morphology'] },
})

export default manifest
