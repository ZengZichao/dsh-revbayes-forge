/**
 * pack-coalescent-demography — multispecies coalescent, coalescent skyline,
 * and StairwayPlot demographic histories.
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

const SOURCE = 'pack:coalescent-demography'
const ANALYSES = ['multispecies_coalescent', 'skyline', 'stairwayplot']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'coalescent',
    code: 'COA1001',
    analyses: ANALYSES,
    defaultAnalysis: 'multispecies_coalescent',
    requireDataFile: false,
  })
  const data = base.data
  const type = asString(data.type, 'data.type', { code: 'COA1002', defaultValue: 'DNA', enumValues: ['DNA', 'RNA', 'Standard', 'Binary'] })
  const substitution = optionalObject(spec.substitution, 'substitution', 'COA1003')
  const model = asString(substitution.model, 'substitution.model', { code: 'COA1004', defaultValue: 'JC', enumValues: ['JC', 'HKY', 'GTR'] })
  const ploidy = asNumber(data.ploidy, 'data.ploidy', { code: 'COA1005', defaultValue: 2, min: 1, max: 8 })
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'COA1006', defaultGenerations: 30000 })

  if (base.analysis === 'stairwayplot') {
    const sfs = spec.sfs
    if (!Array.isArray(sfs) || sfs.length < 3) throw new PackSpecError('COA1007', 'sfs must be an array of at least three folded site-frequency counts for stairwayplot.', 'sfs')
    const counts = sfs.map((value, index) => asNumber(value, `sfs[${index}]`, { code: 'COA1008', min: 0 }))
    const intervals = asInteger(spec.intervals, 'intervals', { code: 'COA1009', defaultValue: Math.min(10, counts.length), min: 1, max: 100 })
    const mu = asNumber(spec.mutation_rate, 'mutation_rate', { code: 'COA1010', defaultValue: 2.8e-9, min: 0, exclusiveMin: true })
    const generationTime = asNumber(spec.generation_time, 'generation_time', { code: 'COA1011', defaultValue: 2, min: 0, exclusiveMin: true })
    return { ...base, type, model, ploidy, counts, intervals, mu, generationTime, mcmc }
  }

  const file = asString(data.file, 'data.file', { code: 'COA1012', required: true })
  const treeFile = asString(data.species_tree ?? spec.tree?.file, 'data.species_tree', { code: 'COA1013', required: base.analysis === 'multispecies_coalescent' })
  const populationSize = asNumber(spec.demography?.population_size, 'demography.population_size', { code: 'COA1014', defaultValue: 0.01, min: 0, exclusiveMin: true })
  const windowCount = asInteger(spec.demography?.windows, 'demography.windows', { code: 'COA1015', defaultValue: 5, min: 1, max: 100 })
  const loci = Array.isArray(spec.data?.loci) ? spec.data.loci.map((item, index) => asString(item, `data.loci[${index}]`, { code: 'COA1016', required: true })) : null
  const geneTree = spec.tree?.file != null ? asString(spec.tree.file, 'tree.file', { code: 'COA1017' }) : null
  return { ...base, type, model, ploidy, file, treeFile, populationSize, windowCount, loci, geneTree, mcmc }
}

function substitutionLines(spec, stateCount = 4) {
  if (spec.model === 'JC') return ['Q <- fnJC(4)', '']
  const lines = ['pi_prior <- v(1,1,1,1)', 'pi ~ dnDirichlet(pi_prior)', 'moves.append( mvBetaSimplex(pi, weight=2) )']
  if (spec.model === 'HKY') {
    lines.push('kappa ~ dnLognormal(0.0, 1.0)', 'moves.append( mvScale(kappa, weight=1) )', 'Q := fnHKY(kappa, pi)')
  } else {
    lines.push('er_prior <- v(1,1,1,1,1,1)', 'er ~ dnDirichlet(er_prior)', 'moves.append( mvBetaSimplex(er, weight=3) )', 'Q := fnGTR(er, pi)')
  }
  return lines
}

function renderMsc(spec) {
  const sections = [
    section('Reading Data and the Species Tree', 100, [
      `data <- readDiscreteCharacterData(${JSON.stringify(spec.file)})`,
      'taxa <- data.taxa()',
      `observed_species_tree <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
      'species_tree <- observed_species_tree',
      'num_species <- species_tree.ntips()',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
    ]),
    section('Multispecies Coalescent Gene Tree', 200, [
      `mean_Ne ~ dnGamma(1.0, 1.0)`,
      `mean_Ne.setValue(${spec.populationSize})`,
      'moves.append( mvScale(mean_Ne, lambda=1.0, tune=true, weight=2.0) )',
      'gene_tree ~ dnMultiSpeciesCoalescent(speciesTree=species_tree, Ne=mean_Ne, taxa=taxa)',
      'moves.append( mvNNI(gene_tree, weight=num_species/2.0) )',
      'moves.append( mvNarrow(gene_tree, weight=num_species/10.0) )',
      'moves.append( mvFNPR(gene_tree, weight=num_species/10.0) )',
      'moves.append( mvSubtreeScale(gene_tree, weight=num_species/10.0) )',
      'moves.append( mvNodeTimeSlideUniform(gene_tree, weight=num_species) )',
    ]),
    section('Clock and Substitution Model', 300, [
      'clock_rate ~ dnUniform(0.0, 100.0)',
      'clock_rate.setValue(1e-4)',
      'moves.append( mvSlide(clock_rate, delta=0.01, weight=1.0) )',
      ...substitutionLines(spec),
      `seq ~ dnPhyloCTMC(tree=gene_tree, Q=Q, branchRates=clock_rate, type="DNA")`,
      'seq.clamp(data)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'gene_tree', treeName: 'gene_tree',
      extraScreen: ['mean_Ne', 'clock_rate'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: 'coalescent/multispecies_coalescent', dataFile: spec.file, title: 'Multispecies coalescent analysis', sections })
}

function renderSkyline(spec) {
  const theta = Array.from({ length: spec.windowCount }, (_, index) => `theta[${index + 1}] ~ dnLoguniform(1e-5, 1e5)`).join('\n')
  const thetaMoves = Array.from({ length: spec.windowCount }, (_, index) => `    moves.append( mvScale(theta[${index + 1}], weight=2) )`).join('\n')
  const times = Array.from({ length: spec.windowCount }, (_, index) => (index * 10).toString()).join(', ')
  const events = Array.from({ length: spec.windowCount }, () => '10').join(', ')
  const sections = [
    section('Reading the Data and Gene Tree', 100, [
      `data <- readDiscreteCharacterData(${JSON.stringify(spec.file)})`,
      'taxa <- data.taxa()',
      'num_taxa <- data.ntaxa()',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
      spec.geneTree === null ? 'observed_tree <- readTrees("data/gene.tre")[1]' : `observed_tree <- readTrees(${JSON.stringify(spec.geneTree)})[1]`,
    ]),
    section('Coalescent Skyline Model', 200, [
      `for (k in 1:${spec.windowCount}) {`,
      '    theta[k] ~ dnLoguniform(1e-5, 1e5)',
      '    moves.append( mvScale(theta[k], weight=2) )',
      '}',
      `times <- v(${times})`,
      `events_per_interval <- v(${events})`,
      `coalescent_tree ~ dnCoalescentSkyline(theta=theta, times=times, events_per_interval=events_per_interval, method="events", model="constant", taxa=taxa)`,
      'coalescent_tree.clamp(observed_tree)',
    ]),
    section('Substitution Model and CTMC', 300, [...substitutionLines(spec), 'seq ~ dnPhyloCTMC(tree=coalescent_tree, Q=Q, type="DNA")', 'seq.clamp(data)']),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'seq', treeName: 'coalescent_tree', extraScreen: ['theta'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: 'coalescent/skyline', dataFile: spec.file, title: 'Coalescent skyline analysis', sections })
}

function renderStairway(spec) {
  const sfs = spec.counts.join(', ')
  const intervals = Array.from({ length: spec.intervals }, (_, index) => `theta[${index + 1}] ~ dnUnif(0.0, 0.1)`).join('\n')
  const moves = Array.from({ length: spec.intervals }, (_, index) => `    moves.append( mvScale(theta[${index + 1}], weight=10) )`).join('\n')
  const sections = [
    section('Reading the Site Frequency Spectrum', 100, [
      `obs_sfs = [ ${sfs} ]`,
      'N_IND   = 2*abs(obs_sfs.size()-1)',
      'N_SITES = round(sum(obs_sfs))',
      'moves     = VectorMoves()',
      'monitors  = VectorMonitors()',
    ]),
    section('Demographic Model', 200, [
      'avmvn = mvAVMVN(weight=100)',
      `for (k in 1:${spec.intervals}) {`,
      '  theta[k] ~ dnUnif( 0.0, 0.1 )',
      '  moves.append( mvScale(theta[k], weight=10) )',
      '  avmvn.addVariable(theta[k])',
      '}',
      'moves.append( avmvn )',
    ]),
    section('Stairway Plot', 300, [
      `sfs ~ dnStairwayPlot( theta, numSites=N_SITES, numIndividuals=N_IND, folded=TRUE, coding="all" )`,
      'sfs.clamp( obs_sfs )',
      'times := sfs.getTimes()',
      `mu <- ${spec.mu}`,
      `GEN_TIME <- ${spec.generationTime}`,
      'ordered_Ne    := rev(theta) / 4.0 / mu',
      'ordered_times := rev(times) / mu * GEN_TIME',
      'esfs := sfs.getExpectedAlleleFrequencies()',
    ]),
    section('Monitors and MCMC', 800, [
      'my_model = model(sfs)',
      '',
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnFile(ordered_Ne, filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_ordered_Ne.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnFile(ordered_times, filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_ordered_times.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnFile(esfs, filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_esfs.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}) )`,
      '',
      `my_mcmc = mcmc(model=my_model, monitors=monitors, moves=moves, nruns=${spec.mcmc.nruns}, combine=${JSON.stringify(spec.mcmc.combine)})`,
      `my_mcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'my_mcmc.operatorSummary()',
      '',
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'coalescent/stairwayplot', dataFile: null, title: 'StairwayPlot demographic analysis', sections })
}

export const manifest = definePack({
  id: 'coalescent-demography',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'verified',
  title: 'Coalescent and Demography',
  description: 'Multispecies coalescent, coalescent skyline, and StairwayPlot demographic histories.',
  analyses: [
    { id: 'multispecies_coalescent', title: 'Multispecies coalescent', maturity: 'verified' },
    { id: 'skyline', title: 'Coalescent skyline', maturity: 'verified' },
    { id: 'stairwayplot', title: 'StairwayPlot', maturity: 'verified' },
  ],
  tools: [{
    name: 'revbayes_generate_coalescent',
    description: 'Generate a multispecies-coalescent, skyline, or StairwayPlot analysis from a structured spec.',
    specDescription: 'Coalescent spec with alignment/tree paths or an SFS, demography settings, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Coalescent analysis variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Alignment and mapping inputs.', properties: { file: { type: 'string' }, species_tree: { type: 'string' }, loci: { type: 'array', items: { type: 'string' } }, type: { type: 'string' }, ploidy: { type: 'number' } } },
      tree: { type: 'object', description: 'Gene tree or species tree.', properties: { file: { type: 'string' } } },
      substitution: { type: 'object', description: 'Substitution model.', properties: { model: { type: 'string', enum: ['JC', 'HKY', 'GTR'] } } },
      demography: { type: 'object', description: 'Population-size settings.', properties: { population_size: { type: 'number' }, windows: { type: 'number' } } },
      sfs: { type: 'array', items: { type: 'number' }, description: 'Folded site-frequency spectrum for stairwayplot.' },
      intervals: { type: 'number', description: 'Number of StairwayPlot epochs.' },
      mutation_rate: { type: 'number' },
      generation_time: { type: 'number' },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.character', 'data.snp', 'substitution.dna', 'tree.coalescent', 'demography.skyline', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => {
        if (normalized.analysis === 'multispecies_coalescent') return renderMsc(normalized)
        if (normalized.analysis === 'skyline') return renderSkyline(normalized)
        return renderStairway(normalized)
      },
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/coalescent'] },
})

export default manifest
