/**
 * pack-fbd — fossilized birth-death analyses (FBD, FBD range matrix).
 */
import {
  definePack,
  buildPackScript,
  normalizeBaseSpec,
  normalizeMcmc,
  asObject,
  asString,
  asNumber,
  asInteger,
  asProbability,
  asStringArray,
  optionalObject,
  section,
  renderSections,
  PackSpecError,
} from '../spec.js'

const SOURCE = 'pack:fbd'

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'fbd',
    code: 'FBD1001',
    analyses: ['fbd', 'fbd_simple', 'fbd_range'],
    defaultAnalysis: 'fbd',
  })
  const data = base.data
  const type = asString(data.type, 'data.type', { code: 'FBD1002', defaultValue: 'Standard', enumValues: ['Standard', 'Binary', 'DNA'] })
  const stateCount = asInteger(data.state_count, 'data.state_count', { code: 'FBD1003', defaultValue: type === 'DNA' ? 4 : 2, min: 2, max: 64 })
  const taxaFile = base.analysis === 'fbd_range'
    ? asString(data.file, 'data.file', { code: 'FBD1004', required: true })
    : asString(data.taxa_file, 'data.taxa_file', { code: 'FBD1004', required: true })
  const matrixFile = asString(data.matrix_file, 'data.matrix_file', { code: 'FBD1005', defaultValue: data.file })
  const fossilFile = asString(data.fossil_file, 'data.fossil_file', { code: 'FBD1006', defaultValue: null })
  const substitution = optionalObject(spec.substitution, 'substitution', 'FBD1007')
  const model = asString(substitution.model, 'substitution.model', { code: 'FBD1008', defaultValue: 'Mk', enumValues: ['Mk', 'Mkv', 'GTR'] })
  const gamma = asObject(substitution.gamma ?? { categories: 4 }, 'substitution.gamma', 'FBD1009')
  const gammaCategories = asInteger(gamma.categories, 'substitution.gamma.categories', { code: 'FBD1010', defaultValue: 4, min: 2, max: 20 })
  const fbd = optionalObject(spec.fbd, 'fbd', 'FBD1011')
  const lambda = asNumber(fbd.lambda, 'fbd.lambda', { code: 'FBD1012', defaultValue: 1.0, min: 0, exclusiveMin: true })
  const mu = asNumber(fbd.mu, 'fbd.mu', { code: 'FBD1013', defaultValue: 0.2, min: 0 })
  const psi = asNumber(fbd.psi, 'fbd.psi', { code: 'FBD1014', defaultValue: 0.1, min: 0 })
  const rho = asProbability(fbd.rho, 'fbd.rho', { code: 'FBD1015', defaultValue: 0.5, allowOne: true })
  const origin = asNumber(fbd.origin, 'fbd.origin', { code: 'FBD1016', defaultValue: 100.0, min: 0, exclusiveMin: true })
  if (mu >= lambda) throw new PackSpecError('FBD1017', 'fbd.mu must be smaller than fbd.lambda for a viable birth-death process.', 'fbd.mu')
  let timeline = null
  let fossilCounts = null
  if (base.analysis === 'fbd_range') {
    timeline = Array.isArray(fbd.timeline)
      ? fbd.timeline.map((value, index) => asNumber(value, `fbd.timeline[${index}]`, { code: 'FBD1018', min: 0 }))
      : null
    if (timeline === null || timeline.length < 2) {
      throw new PackSpecError('FBD1018', 'fbd.timeline must contain at least two interval boundaries for fbd_range.', 'fbd.timeline')
    }
    fossilCounts = asString(data.fossil_counts_file, 'data.fossil_counts_file', { code: 'FBD1019', required: true })
  }
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'FBD1020', defaultGenerations: 20000 })
  return { ...base, type, stateCount, taxaFile, matrixFile, fossilFile, model, gammaCategories, lambda, mu, psi, rho, origin, timeline, fossilCounts, mcmc }
}

function dataFossilLines(spec) {
  const lines = [
    `taxa <- readTaxonData(${JSON.stringify(spec.taxaFile)})`,
    `morpho <- readDiscreteCharacterData(${JSON.stringify(spec.matrixFile)})`,
    'n_taxa <- taxa.size()',
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
  ]
  return lines
}

function fbdTreeLines(spec) {
  const lines = [
    `speciation_rate ~ dnExponential(${spec.lambda === 1.0 ? 10.0 : Math.max(0.01, 1 / spec.lambda)})`,
    `extinction_rate ~ dnExponential(${spec.mu > 0 ? 1 / spec.mu : 10.0})`,
    'moves.append( mvScale(speciation_rate, weight=1) )',
    'moves.append( mvScale(extinction_rate, weight=1) )',
    'diversification := speciation_rate - extinction_rate',
    'turnover := extinction_rate/speciation_rate',
    `rho <- ${spec.rho}`,
    `psi ~ dnExponential(${spec.psi > 0 ? 1 / spec.psi : 10.0})`,
    'moves.append( mvScale(psi, weight=1) )',
    `origin_time ~ dnUniform(${Math.max(0, spec.origin * 0.5)}, ${spec.origin * 1.5})`,
    'moves.append( mvSlide(origin_time, weight=1.0) )',
    'fbd_tree ~ dnFBDP(origin=origin_time, lambda=speciation_rate, mu=extinction_rate, psi=psi, rho=rho, taxa=taxa)',
    'moves.append( mvFNPR(fbd_tree, weight=15.0) )',
    'moves.append( mvCollapseExpandFossilBranch(fbd_tree, origin_time, weight=6.0) )',
    'moves.append( mvNodeTimeSlideUniform(fbd_tree, weight=40.0) )',
    'moves.append( mvRootTimeSlideUniform(fbd_tree, origin_time, weight=5.0) )',
    'num_samp_anc := fbd_tree.numSampledAncestors()',
  ]
  if (spec.fossilFile !== null) {
    lines.push(
      '',
      'fossils = fbd_tree.getFossils()',
      'for (i in 1:fossils.size()) {',
      '    t[i] := tmrca(fbd_tree, clade(fossils[i]))',
      '    a_i = fossils[i].getMinAge()',
      '    b_i = fossils[i].getMaxAge()',
      '    F[i] ~ dnUniform(t[i] - b_i, t[i] - a_i)',
      '    F[i].clamp( 0 )',
      '}',
      'moves.append( mvFossilTimeSlideUniform(fbd_tree, origin_time, weight=5.0) )',
    )
  }
  return lines
}

function substitutionLines(spec) {
  if (spec.type === 'DNA' || spec.model === 'GTR') {
    return [
      'pi_prior <- v(1,1,1,1)',
      'pi ~ dnDirichlet(pi_prior)',
      'moves.append( mvBetaSimplex(pi, weight=2) )',
      'er_prior <- v(1,1,1,1,1,1)',
      'er ~ dnDirichlet(er_prior)',
      'moves.append( mvBetaSimplex(er, weight=3) )',
      'Q_morpho := fnGTR(er, pi)',
      '',
      'alpha_morpho ~ dnExponential( 1.0 )',
      `rates_morpho := fnDiscretizeGamma( alpha_morpho, alpha_morpho, ${spec.gammaCategories} )`,
      'moves.append( mvScale(alpha_morpho, weight=5.0) )',
      '',
      'clock_morpho ~ dnExponential(1.0)',
      'moves.append( mvScale(clock_morpho, weight=4.0) )',
      '',
      `phyMorpho ~ dnPhyloCTMC(tree=fbd_tree, siteRates=rates_morpho, branchRates=clock_morpho, Q=Q_morpho, type=${JSON.stringify(spec.type)})`,
      'phyMorpho.clamp(morpho)',
    ]
  }
  return [
    `Q_morpho <- fnJC(${spec.stateCount})`,
    '',
    'alpha_morpho ~ dnExponential( 1.0 )',
    `rates_morpho := fnDiscretizeGamma( alpha_morpho, alpha_morpho, ${spec.gammaCategories} )`,
    'moves.append( mvScale(alpha_morpho, weight=5.0) )',
    '',
    'clock_morpho ~ dnExponential(1.0)',
    'moves.append( mvScale(clock_morpho, weight=4.0) )',
    '',
    `phyMorpho ~ dnPhyloCTMC(tree=fbd_tree, siteRates=rates_morpho, branchRates=clock_morpho, Q=Q_morpho, type="Standard"${spec.model === 'Mkv' ? ', coding="variable"' : ''})`,
    'phyMorpho.clamp(morpho)',
  ]
}

function renderFbd(spec) {
  const sections = [
    section('Reading Fossil and Character Data', 100, dataFossilLines(spec)),
    section('Fossilized Birth-Death Tree Prior', 200, fbdTreeLines(spec)),
    section('Substitution and Clock Model', 300, substitutionLines(spec)),
    section('Monitors', 800, [
      'mymodel = model(fbd_tree)',
      '',
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.log`)}, printgen=${spec.mcmc.sampleEvery}${spec.fossilFile === null ? '' : ', exclude=["F"]'}) )`,
      `monitors.append( mnFile(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.trees`)}, printgen=${spec.mcmc.sampleEvery}, fbd_tree) )`,
      `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}, origin_time, num_samp_anc) )`,
    ]),
    section('MCMC Analysis', 900, [
      'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)',
      `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'mymcmc.operatorSummary()',
      '',
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: `fbd/${spec.analysis}`, dataFile: spec.matrixFile, title: 'Fossilized birth-death analysis', sections })
}

function renderRange(spec) {
  const timeline = `v(${spec.timeline.join(', ')})`
  const sections = [
    section('Reading Stratigraphic Ranges and Fossil Counts', 100, [
      `taxa = readTaxonData(file = ${JSON.stringify(spec.taxaFile)})`,
      `k <- readDataDelimitedFile(file = ${JSON.stringify(spec.fossilCounts)}, header = true, rownames = true)`,
      `timeline <- ${timeline}`,
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
      'alpha <- 10',
    ]),
    section('Fossilized Birth-Death Range Model', 200, [
      'for (i in 1:(timeline.size()+1)) {',
      '    mu[i] ~ dnExp(alpha)',
      '    lambda[i] ~ dnExp(alpha)',
      '    psi[i] ~ dnExp(alpha)',
      '    div[i] := lambda[i] - mu[i]',
      '    turnover[i] := mu[i]/lambda[i]',
      '    moves.append( mvScale(mu[i], lambda=0.01) )',
      '    moves.append( mvScale(mu[i], lambda=0.1) )',
      '    moves.append( mvScale(mu[i], lambda=1) )',
      '    moves.append( mvScale(lambda[i], lambda=0.01) )',
      '    moves.append( mvScale(lambda[i], lambda=0.1) )',
      '    moves.append( mvScale(lambda[i], lambda=1) )',
      '    moves.append( mvScale(psi[i], lambda=0.01) )',
      '    moves.append( mvScale(psi[i], lambda=0.1) )',
      '    moves.append( mvScale(psi[i], lambda=1) )',
      '}',
      `rho <- ${spec.rho}`,
      'bd ~ dnFBDRMatrix(taxa=taxa, lambda=lambda, mu=mu, psi=psi, rho=rho, timeline=timeline, k=k)',
      'moves.append( mvMatrixElementScale(bd, lambda=0.01, weight=taxa.size()) )',
      'moves.append( mvMatrixElementScale(bd, lambda=0.1, weight=taxa.size()) )',
      'moves.append( mvMatrixElementScale(bd, lambda=1, weight=taxa.size()) )',
      'moves.append( mvMatrixElementSlide(bd, delta=0.01, weight=taxa.size()) )',
      'moves.append( mvMatrixElementSlide(bd, delta=0.1, weight=taxa.size()) )',
      'moves.append( mvMatrixElementSlide(bd, delta=1, weight=taxa.size()) )',
    ]),
    section('Monitors and MCMC', 800, [
      'mymodel = model(bd)',
      '',
      `monitors.append( mnScreen(lambda, mu, psi, printgen=${spec.mcmc.screenEvery}) )`,
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnFile(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_speciation_rates.log`)}, lambda, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnFile(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_extinction_rates.log`)}, mu, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnFile(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_sampling_rates.log`)}, psi, printgen=${spec.mcmc.sampleEvery}) )`,
      '',
      `mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves, moveschedule=${JSON.stringify(spec.mcmc.moveschedule)})`,
      `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'mymcmc.operatorSummary()',
      '',
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: `fbd/${spec.analysis}`, dataFile: spec.taxaFile, title: 'Fossilized birth-death range analysis', sections })
}

export const manifest = definePack({
  id: 'fbd',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'verified',
  title: 'Fossilized Birth-Death',
  description: 'Joint inference of topology, fossil occurrence times, and diversification under the fossilized birth-death process.',
  analyses: [
    { id: 'fbd', title: 'FBD', maturity: 'verified' },
    { id: 'fbd_simple', title: 'FBD simple', maturity: 'verified' },
    { id: 'fbd_range', title: 'FBD range', maturity: 'verified' },
  ],
  tools: [{
    name: 'revbayes_generate_fbd',
    description: 'Generate a fossilized birth-death analysis (fbd, fbd_simple, or fbd_range) from a structured spec.',
    specDescription: 'FBD spec with analysis, data paths, substitution, fbd rates/origin, and mcmc settings.',
    parameters: () => ({
      analysis: { type: 'string', enum: ['fbd', 'fbd_simple', 'fbd_range'], description: 'FBD analysis variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: {
        type: 'object',
        description: 'Character matrix, taxon file, optional fossil ranges/counts.',
        properties: {
          file: { type: 'string', description: 'Character matrix path (or taxon file for fbd_range).' },
          taxa_file: { type: 'string', description: 'Taxon table for fbd/fbd_simple.' },
          matrix_file: { type: 'string', description: 'Character matrix when the taxon file is separate.' },
          fossil_file: { type: 'string', description: 'Optional fossil occurrence table with min/max ages.' },
          fossil_counts_file: { type: 'string', description: 'Fossil counts table for fbd_range.' },
          type: { type: 'string', enum: ['Standard', 'Binary', 'DNA'], description: 'Character type.' },
          state_count: { type: 'number', description: 'Observed state count.' },
        },
      },
      substitution: {
        type: 'object',
        description: 'Substitution model.',
        properties: {
          model: { type: 'string', enum: ['Mk', 'Mkv', 'GTR'], description: 'Mk (core), Mkv (variable coding), or GTR.' },
          gamma: { type: 'object', description: 'Gamma rate categories.', properties: { categories: { type: 'number', description: 'Number of categories.' } } },
        },
      },
      fbd: {
        type: 'object',
        description: 'FBD rates and origin.',
        properties: {
          lambda: { type: 'number', description: 'Speciation rate.' },
          mu: { type: 'number', description: 'Extinction rate.' },
          psi: { type: 'number', description: 'Fossil sampling rate.' },
          rho: { type: 'number', description: 'Extant sampling probability.' },
          origin: { type: 'number', description: 'Origin time.' },
          timeline: { type: 'array', items: { type: 'number' }, description: 'Interval boundaries for fbd_range.' },
        },
      },
      mcmc: { type: 'object', description: 'MCMC settings.', properties: { generations: { type: 'number' }, sample_every: { type: 'number' }, output_dir: { type: 'string' } } },
    }),
  }],
  dependencies: [],
  blocks: ['data.fossil', 'data.character', 'substitution.morph', 'substitution.dna', 'tree.fbd', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => (normalized.analysis === 'fbd_range' ? renderRange(normalized) : renderFbd(normalized)),
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/fbd'] },
})

export default manifest
