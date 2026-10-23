/**
 * pack-chromosome — ChromEvol, BiChroM, and ChromoSSE chromosome-number
 * evolution analyses.
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
  optionalObject,
  PackSpecError,
} from '../spec.js'

const SOURCE = 'pack:chromosome'
const ANALYSES = ['chromevol', 'bichrom', 'chromosse']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'chromosome',
    code: 'CHR1001',
    analyses: ANALYSES,
    defaultAnalysis: 'chromevol',
    requireDataFile: false,
  })
  const data = optionalObject(spec.data, 'data', 'CHR1002')
  const countsFile = asString(data.counts_file ?? data.file, 'data.counts_file', { code: 'CHR1003', required: true })
  const treeFile = asString(data.tree_file ?? spec.tree?.file, 'data.tree_file', { code: 'CHR1004', required: true })
  const maxChromosome = asInteger(spec.model?.max_chromosome, 'model.max_chromosome', { code: 'CHR1005', defaultValue: 30, min: 3, max: 500 })
  const gain = asNumber(spec.model?.gain, 'model.gain', { code: 'CHR1006', defaultValue: 1.0, min: 0, exclusiveMin: true })
  const loss = asNumber(spec.model?.loss, 'model.loss', { code: 'CHR1007', defaultValue: 1.0, min: 0, exclusiveMin: true })
  const polyploidy = asNumber(spec.model?.polyploidy, 'model.polyploidy', { code: 'CHR1008', defaultValue: 0.1, min: 0 })
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'CHR1009', defaultGenerations: 20000 })
  return { ...base, countsFile, treeFile, maxChromosome, gain, loss, polyploidy, mcmc }
}

function preamble(spec) {
  return [
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
    '',
    `phylogeny <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
    `max_chromo = ${spec.maxChromosome}`,
    `chromo_data = readCharacterDataDelimited(${JSON.stringify(spec.countsFile)}, stateLabels=(max_chromo + 1), type="NaturalNumbers", separator="\\t", header=FALSE)`,
    'num_taxa = phylogeny.ntips()',
    'num_branches = 2 * num_taxa - 2',
  ]
}

function renderChromEvol(spec) {
  const sections = [
    section('Reading Chromosome Counts and Tree', 100, preamble(spec)),
    section('ChromEvol Model', 200, [
      `gamma ~ dnExponential(${1 / spec.gain})`,
      `delta ~ dnExponential(${1 / spec.loss})`,
      `rho ~ dnExponential(${spec.polyploidy > 0 ? 1 / spec.polyploidy : 10.0})`,
      'moves.append( mvScale(gamma, lambda=1, weight=1) )',
      'moves.append( mvScale(delta, lambda=1, weight=1) )',
      'moves.append( mvScale(rho, lambda=1, weight=1) )',
      'Q := fnChromosomes(max_chromo, gamma, delta, rho)',
      'root_frequencies := simplex(rep(1, max_chromo + 1))',
      'chromo_ctmc ~ dnPhyloCTMC(Q=Q, tree=phylogeny, rootFrequencies=root_frequencies, type="NaturalNumbers")',
      'chromo_ctmc.clamp(chromo_data)',
    ]),
    section('Monitors and MCMC', 800, [
      'mymodel = model(phylogeny)',
      '',
      `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}) )`,
      `monitors.append( mnJointConditionalAncestralState(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_anc_states.log`)}, printgen=${spec.mcmc.sampleEvery}, tree=phylogeny, ctmc=chromo_ctmc, type="NaturalNumbers") )`,
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_model.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      '',
      'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)',
      `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'mymcmc.operatorSummary()',
      '',
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'chromosome/chromevol', dataFile: spec.countsFile, title: 'ChromEvol analysis', sections })
}

function renderBiChroM(spec) {
  const sections = [
    section('Reading Chromosome Counts and Tree', 100, preamble(spec)),
    section('BiChroM Model', 200, [
      '# BiChroM adds both diploid and polyploid chromosome-number states',
      'gamma_d ~ dnExponential(1.0)',
      'delta_d ~ dnExponential(1.0)',
      'rho_d ~ dnExponential(10.0)',
      'gamma_p ~ dnExponential(1.0)',
      'delta_p ~ dnExponential(1.0)',
      'rho_p ~ dnExponential(10.0)',
      'moves.append( mvScale(gamma_d, weight=1) )',
      'moves.append( mvScale(delta_d, weight=1) )',
      'moves.append( mvScale(rho_d, weight=1) )',
      'moves.append( mvScale(gamma_p, weight=1) )',
      'moves.append( mvScale(delta_p, weight=1) )',
      'moves.append( mvScale(rho_p, weight=1) )',
      'Q := fnChromosomesPloidy(max_chromo, gamma_d, delta_d, rho_d, 0.0, 0.0, 0.0, gamma_p, delta_p, rho_p, 0.0, 0.0, 0.0, 0.0)',
      'root_frequencies := simplex(rep(1, max_chromo + 1))',
      'chromo_ctmc ~ dnPhyloCTMC(Q=Q, tree=phylogeny, rootFrequencies=root_frequencies, type="NaturalNumbers")',
      'chromo_ctmc.clamp(chromo_data)',
    ]),
    section('Monitors and MCMC', 800, [
      'mymodel = model(phylogeny)',
      '',
      `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}) )`,
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_model.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      '',
      'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)',
      `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'mymcmc.operatorSummary()',
      '',
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'chromosome/bichrom', dataFile: spec.countsFile, title: 'BiChroM analysis', sections })
}

function renderChromoSSE(spec) {
  const sections = [
    section('Reading Chromosome Counts and Tree', 100, preamble(spec)),
    section('ChromoSSE Model', 200, [
      'speciation_rates <- rep(0.1, max_chromo + 1)',
      'rate_multipliers <- rep(1.0, max_chromo + 1)',
      'clado_events := fnChromosomesCladoEventsBD(speciation_rates, rate_multipliers, max_chromo)',
      'clado_probs := fnChromosomesCladoProbs(simplex(1,1,1,1,1), max_chromo)',
      'Q := fnChromosomes(max_chromo, 1.0, 1.0, 0.1)',
      'chromo_ctmc ~ dnPhyloCTMCClado(tree=phylogeny, Q=Q, cladoProbs=clado_probs, type="NaturalNumbers", nSites=1)',
      'chromo_ctmc.clamp(chromo_data)',
      'birth_rate ~ dnExponential(1.0)',
      'death_rate ~ dnExponential(1.0)',
      'moves.append( mvScale(birth_rate, weight=2) )',
      'moves.append( mvScale(death_rate, weight=2) )',
      'timetree ~ dnBDP(lambda=birth_rate, mu=death_rate, rho=1.0, rootAge=phylogeny.rootAge(), samplingStrategy="uniform", condition="survival", taxa=phylogeny.taxa())',
      'timetree.clamp(phylogeny)',
    ]),
    section('Monitors and MCMC', 800, [
      'mymodel = model(chromo_ctmc)',
      '',
      `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}, birth_rate, death_rate) )`,
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_model.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnJointConditionalAncestralState(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}_anc_states.log`)}, printgen=${spec.mcmc.sampleEvery}, tree=phylogeny, ctmc=chromo_ctmc, type="NaturalNumbers") )`,
      '',
      'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)',
      `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'mymcmc.operatorSummary()',
      '',
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'chromosome/chromosse', dataFile: spec.countsFile, title: 'ChromoSSE analysis', sections })
}

export const manifest = definePack({
  id: 'chromosome',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'golden',
  title: 'Chromosome Evolution',
  description: 'ChromEvol, BiChroM, and ChromoSSE models of chromosome-number evolution.',
  analyses: [
    { id: 'chromevol', title: 'ChromEvol', maturity: 'golden' },
    { id: 'bichrom', title: 'BiChroM', maturity: 'golden' },
    { id: 'chromosse', title: 'ChromoSSE', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_generate_chromosome',
    description: 'Generate a ChromEvol, BiChroM, or ChromoSSE analysis from a structured spec.',
    specDescription: 'Chromosome spec with counts, tree, max chromosome number, rates, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Chromosome model variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Chromosome counts and tree.', properties: { counts_file: { type: 'string' }, tree_file: { type: 'string' } } },
      tree: { type: 'object', description: 'Tree file.', properties: { file: { type: 'string' } } },
      model: { type: 'object', description: 'Chromosome model parameters.', properties: { max_chromosome: { type: 'number' }, gain: { type: 'number' }, loss: { type: 'number' }, polyploidy: { type: 'number' } } },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.chromosome', 'tree.time', 'chromosome.chromevol', 'chromosome.bichrom', 'chromosome.sse', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => {
        if (normalized.analysis === 'bichrom') return renderBiChroM(normalized)
        if (normalized.analysis === 'chromosse') return renderChromoSSE(normalized)
        return renderChromEvol(normalized)
      },
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/chromosome'] },
})

export default manifest
