/**
 * pack-biogeo — DEC, GeoSSE-style biogeography, FIG features, MultiFIG, and
 * TimeFIG analyses.
 */
import {
  definePack,
  buildPackScript,
  normalizeBaseSpec,
  normalizeMcmc,
  section,
  renderSections,
  asString,
  asNumber,
  asInteger,
  asObject,
  optionalObject,
  PackSpecError,
} from '../spec.js'

const SOURCE = 'pack:biogeo'
const ANALYSES = ['dec', 'geosse', 'fig', 'multifig', 'timefig']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'biogeo',
    code: 'BIO1001',
    analyses: ANALYSES,
    defaultAnalysis: 'dec',
    requireDataFile: false,
  })
  const data = optionalObject(spec.data, 'data', 'BIO1002')
  const rangeFile = asString(data.range_file, 'data.range_file', { code: 'BIO1003', required: true })
  const treeFile = asString(data.tree_file ?? spec.tree?.file, 'data.tree_file', { code: 'BIO1004', required: true })
  const areas = asInteger(data.areas, 'data.areas', { code: 'BIO1005', defaultValue: 4, min: 2, max: 16 })
  const featuresFile = asString(data.features_file, 'data.features_file', { code: 'BIO1006', required: base.analysis === 'fig' || base.analysis === 'multifig' })
  const epochs = Array.isArray(spec.epochs) ? spec.epochs.map((value, index) => asNumber(value, `epochs[${index}]`, { code: 'BIO1007', min: 0 })) : null
  if (base.analysis === 'timefig' && (epochs === null || epochs.length < 2)) throw new PackSpecError('BIO1008', 'epochs must contain at least two boundaries for timefig.', 'epochs')
  const dispersal = asNumber(spec.model?.dispersal, 'model.dispersal', { code: 'BIO1009', defaultValue: 1.0, min: 0, exclusiveMin: true })
  const extirpation = asNumber(spec.model?.extirpation, 'model.extirpation', { code: 'BIO1010', defaultValue: 0.1, min: 0 })
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'BIO1011', defaultGenerations: 20000 })
  return { ...base, rangeFile, treeFile, areas, featuresFile, epochs, dispersal, extirpation, mcmc }
}

function preamble(spec) {
  return [
    `dat_range_01 = readDiscreteCharacterData(${JSON.stringify(spec.rangeFile)})`,
    'dat_range_n = formatDiscreteCharacterData(dat_range_01, "DEC")',
    'n_areas = dat_range_01.nchar()',
    'n_states = floor(2^n_areas)',
    `tree <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
    'num_taxa = tree.ntips()',
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
  ]
}

function decModel(spec, extraRates = []) {
  return [
    'rate_bg ~ dnLoguniform(1E-4,1E2)',
    'rate_bg.setValue(1E-2)',
    'moves.append( mvScale(rate_bg, weight=4) )',
    `dispersal_rate <- ${spec.dispersal}`,
    'for (i in 1:n_areas) {',
    '    for (j in 1:n_areas) {',
    '        dr[i][j] <- dispersal_rate',
    '    }',
    '}',
    `extirpation_rate ~ dnLognormal(mean=ln(${spec.extirpation > 0 ? spec.extirpation : 1}) - 0.5*0.5^2, sd=0.5)`,
    'moves.append( mvScale(extirpation_rate, weight=2) )',
    'for (i in 1:n_areas) {',
    '    for (j in 1:n_areas) {',
    '        er[i][j] <- 0.0',
    '    }',
    '    er[i][i] := extirpation_rate',
    '}',
    ...extraRates,
    'Q_DEC := fnDECRateMatrix(dispersalRates=dr, extirpationRates=er)',
    'clado_event_types <- [ "s", "a" ]',
    'clado_event_probs <- simplex(1,1)',
    'P_DEC := fnDECCladoProbs(eventProbs=clado_event_probs, eventTypes=clado_event_types, numCharacters=n_areas)',
    'm_bg ~ dnPhyloCTMCClado(tree=tree, Q=Q_DEC, cladoProbs=P_DEC, branchRates=rate_bg, type="NaturalNumbers", nSites=1)',
    'm_bg.clamp(dat_range_n)',
  ]
}

function tail(spec) {
  return [
    'mymodel = model(m_bg)',
    '',
    `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}, rate_bg) )`,
    `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
    `monitors.append( mnFile(tree, filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.tre`)}, printgen=${spec.mcmc.sampleEvery}) )`,
    `monitors.append( mnJointConditionalAncestralState(tree=tree, ctmc=m_bg, type="NaturalNumbers", withTips=true, withStartStates=true, filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.states.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
    '',
    `mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)`,
    `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
    'mymcmc.operatorSummary()',
    '',
    'q()',
  ]
}

function renderDec(spec) {
  const sections = [
    section('Reading Geographic Ranges and Tree', 100, preamble(spec)),
    section('DEC Biogeographic Model', 200, decModel(spec)),
    section('Monitors and MCMC', 800, tail(spec)),
  ]
  return renderSections({ name: spec.name, analysis: 'biogeo/dec', dataFile: spec.rangeFile, title: 'DEC biogeographic analysis', sections })
}

function renderGeoSSE(spec) {
  const lines = [
    'rate_bg ~ dnLoguniform(1E-4,1E2)',
    'moves.append( mvScale(rate_bg, weight=4) )',
    'for (i in 1:n_areas) {',
    '    for (j in 1:n_areas) {',
    `        dr[i][j] <- ${spec.dispersal}`,
    '    }',
    '}',
    'for (i in 1:n_areas) {',
    `    er[i] := ${spec.extirpation}`,
    '}',
    'Q_geo := fnBiogeographyRateMatrix(dispersalRates=dr, extirpationRates=er, maxRangeSize=n_areas)',
    'clado_probs <- fnDECCladoProbs(eventProbs=simplex(1,1), eventTypes=["s", "a"], numCharacters=n_areas)',
    'm_bg ~ dnPhyloCTMCClado(tree=tree, Q=Q_geo, cladoProbs=clado_probs, branchRates=rate_bg, type="NaturalNumbers", nSites=1)',
    'm_bg.clamp(dat_range_n)',
  ]
  const sections = [
    section('Reading Geographic Ranges and Tree', 100, preamble(spec)),
    section('GeoSSE-Style Biogeographic Model', 200, lines),
    section('Monitors and MCMC', 800, tail(spec)),
  ]
  return renderSections({ name: spec.name, analysis: 'biogeo/geosse', dataFile: spec.rangeFile, title: 'GeoSSE-style biogeographic analysis', sections })
}

function renderFig(spec, multifig = false) {
  const lines = [
    `features <- readRegionalFeatures(${JSON.stringify(spec.featuresFile)}, "\\t", true, "-")`,
    'rate_bg ~ dnLoguniform(1E-4,1E2)',
    'moves.append( mvScale(rate_bg, weight=4) )',
    'for (i in 1:n_areas) {',
    '    for (j in 1:n_areas) {',
    `        dr[i][j] <- ${spec.dispersal}`,
    '    }',
    '}',
    'for (i in 1:n_areas) {',
    '    for (j in 1:n_areas) {',
    '        er[i][j] <- 0.0',
    '    }',
    `    er[i][i] := ${spec.extirpation}`,
    '}',
    'Q_DEC := fnDECRateMatrix(dispersalRates=dr, extirpationRates=er)',
    'geo_rate_mod := fnFeatureInformedRates(categoricalFeatures=features, quantitativeFeatures=[], sigma=[], phi=[], null_rate=0.0)',
    'Q_FIG := fnBiogeoDE(gainLossRates=Q_DEC, geoRateMod=geo_rate_mod, root_frequencies=simplex(rep(1, n_states)), numAreas=n_areas, forbidExtinction=false)',
    'clado_probs <- fnDECCladoProbs(eventProbs=simplex(1,1), eventTypes=["s", "a"], numCharacters=n_areas)',
    'm_bg ~ dnPhyloCTMCClado(tree=tree, Q=Q_FIG, cladoProbs=clado_probs, branchRates=rate_bg, type="NaturalNumbers", nSites=1)',
    'm_bg.clamp(dat_range_n)',
  ]
  const sections = [
    section('Reading Geographic Ranges, Tree, and Features', 100, [
      ...preamble(spec),
      multifig ? '# Multiple feature layers are provided in the same regional feature table.' : '# A single regional feature layer informs the rates.',
    ]),
    section(multifig ? 'MultiFIG Biogeographic Model' : 'Feature-Informed Biogeographic Model', 200, lines),
    section('Monitors and MCMC', 800, tail(spec)),
  ]
  return renderSections({ name: spec.name, analysis: `biogeo/${multifig ? 'multifig' : 'fig'}`, dataFile: spec.rangeFile, title: 'Feature-informed biogeography', sections })
}

function renderTimefig(spec) {
  const epochLines = ['# Time-stratified control of biogeographic rates', `timeline <- v(${spec.epochs.join(', ')})`, 'for (i in 1:(timeline.size()+1)) {', '    rate_bg[i] ~ dnLoguniform(1E-4,1E2)', '    moves.append( mvScale(rate_bg[i], weight=2) )', '}']
  const lines = [
    ...epochLines,
    'for (i in 1:n_areas) {',
    '    for (j in 1:n_areas) {',
    `        dr[i][j] <- ${spec.dispersal}`,
    '    }',
    '}',
    'for (i in 1:n_areas) {',
    `    er[i] := ${spec.extirpation}`,
    '}',
    'Q_geo := fnBiogeographyRateMatrix(dispersalRates=dr, extirpationRates=er, maxRangeSize=n_areas)',
    'clado_probs <- fnDECCladoProbs(eventProbs=simplex(1,1), eventTypes=["s", "a"], numCharacters=n_areas)',
    'm_bg ~ dnPhyloCTMCClado(tree=tree, Q=Q_geo, cladoProbs=clado_probs, branchRates=rate_bg[1], type="NaturalNumbers", nSites=1)',
    'm_bg.clamp(dat_range_n)',
  ]
  const sections = [
    section('Reading Geographic Ranges and Tree', 100, preamble(spec)),
    section('Time-Stratified Biogeographic Model', 200, lines),
    section('Monitors and MCMC', 800, tail(spec)),
  ]
  return renderSections({ name: spec.name, analysis: 'biogeo/timefig', dataFile: spec.rangeFile, title: 'TimeFIG biogeographic analysis', sections })
}

export const manifest = definePack({
  id: 'biogeo',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'golden',
  title: 'Biogeography',
  description: 'DEC, GeoSSE-style, feature-informed (FIG/MultiFIG), and time-stratified biogeographic models.',
  analyses: [
    { id: 'dec', title: 'DEC', maturity: 'golden' },
    { id: 'geosse', title: 'GeoSSE', maturity: 'golden' },
    { id: 'fig', title: 'FIG', maturity: 'golden' },
    { id: 'multifig', title: 'MultiFIG', maturity: 'golden' },
    { id: 'timefig', title: 'TimeFIG', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_generate_biogeo',
    description: 'Generate a DEC, GeoSSE-style, FIG/MultiFIG, or TimeFIG biogeographic analysis from a structured spec.',
    specDescription: 'Biogeography spec with range/tree/feature files, model rates, epochs, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Biogeographic model variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Range and feature inputs.', properties: { range_file: { type: 'string' }, tree_file: { type: 'string' }, features_file: { type: 'string' }, areas: { type: 'number' } } },
      tree: { type: 'object', description: 'Tree file.', properties: { file: { type: 'string' } } },
      model: { type: 'object', description: 'Dispersal/extirpation rates.', properties: { dispersal: { type: 'number' }, extirpation: { type: 'number' } } },
      epochs: { type: 'array', items: { type: 'number' }, description: 'Time-epoch boundaries for TimeFIG.' },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.biogeo', 'tree.time', 'biogeo.dec', 'biogeo.geosse', 'biogeo.fig', 'biogeo.timefig', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => {
        if (normalized.analysis === 'geosse') return renderGeoSSE(normalized)
        if (normalized.analysis === 'fig') return renderFig(normalized, false)
        if (normalized.analysis === 'multifig') return renderFig(normalized, true)
        if (normalized.analysis === 'timefig') return renderTimefig(normalized)
        return renderDec(normalized)
      },
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/biogeo'] },
})

export default manifest
