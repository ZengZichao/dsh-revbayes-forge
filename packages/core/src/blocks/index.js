/**
 * Shared script blocks. Each factory returns a block declaring its section,
 * lines, variables, moves/monitors, and capabilities. Packs compose these
 * through the assembly or use them as building blocks for family sections.
 */
import { sectionBlock, makeBlock } from '../assembly.js'

export { makeBlock, sectionBlock }

export function dataCharacterBlock({ file, type = 'DNA', stateCount = null, order = 100, name = 'data' }) {
  const lines = [
    `${name} <- readDiscreteCharacterData(${JSON.stringify(file)})`,
    'taxa <- data.taxa()',
    'num_taxa <- data.ntaxa()',
    'num_branches <- 2 * num_taxa - 3',
  ]
  if (stateCount !== null) lines.push(`num_states <- ${stateCount}`)
  return sectionBlock({
    id: 'data.character',
    title: 'Reading in the Data',
    order,
    lines,
    provides: ['data.character'],
    variables: [{ name, kind: 'constant' }, { name: 'taxa', kind: 'constant' }],
  })
}

export function dataTaxonBlock({ file, name = 'taxa', order = 90 }) {
  return sectionBlock({
    id: 'data.taxon',
    title: 'Reading Taxon Data',
    order,
    lines: [`${name} <- readTaxonData(${JSON.stringify(file)})`, `${name}_count <- ${name}.size()`],
    provides: ['data.taxon'],
    variables: [{ name, kind: 'constant' }],
  })
}

export function dataFossilBlock({ file = null, name = 'fossils', order = 92 }) {
  const lines = file === null
    ? [`${name}_taxa <- readTaxonData(${JSON.stringify('data/fossils.tsv')})`]
    : [`${name}_taxa <- readTaxonData(${JSON.stringify(file)})`]
  return sectionBlock({
    id: 'data.fossil',
    title: 'Reading Fossil Occurrences',
    order,
    lines,
    provides: ['data.fossil'],
    variables: [{ name: `${name}_taxa`, kind: 'constant' }],
  })
}

export function dataContinuousBlock({ file, order = 100 }) {
  return sectionBlock({
    id: 'data.continuous',
    title: 'Reading Continuous Trait Data',
    order,
    lines: [
      `data <- readContinuousCharacterData(${JSON.stringify(file)})`,
      'taxa <- data.taxa()',
      'num_taxa <- data.ntaxa()',
      'num_traits <- data.nchar()',
    ],
    provides: ['data.continuous'],
    variables: [{ name: 'data', kind: 'constant' }],
  })
}

export function dataStatesBlock({ file, order = 95 }) {
  return sectionBlock({
    id: 'data.states',
    title: 'Reading Character States',
    order,
    lines: [
      `observed_phylogeny <- readTrees(${JSON.stringify(file)})[1]`,
      'data_states <- readDiscreteCharacterData(' + JSON.stringify(file.replace(/\.(tre|tree|nex)$/i, '_states.nex')) + ')',
      'num_states <- data_states.nchar()',
    ],
    provides: ['data.states'],
    variables: [{ name: 'observed_phylogeny', kind: 'constant' }],
  })
}

export function dataBiogeoBlock({ rangeFile, treeFile, order = 100 }) {
  return sectionBlock({
    id: 'data.biogeo',
    title: 'Reading Geographic Range Data',
    order,
    lines: [
      `dat_range_01 = readDiscreteCharacterData(${JSON.stringify(rangeFile)})`,
      'dat_range_n = formatDiscreteCharacterData(dat_range_01, "DEC")',
      'n_areas = dat_range_01.nchar()',
      'n_states = floor(2^n_areas)',
      `tree <- readTrees(${JSON.stringify(treeFile)})[1]`,
      'num_taxa = tree.ntips()',
    ],
    provides: ['data.biogeo'],
    variables: [{ name: 'dat_range_n', kind: 'constant' }, { name: 'tree', kind: 'constant' }],
  })
}

export function dataSnpBlock({ sfs = null, order = 100 }) {
  const values = Array.isArray(sfs) ? sfs.map((n) => Number(n)).join(', ') : '405017549, 1393598, 922300, 682542, 530181, 421015, 360546, 303107, 257549, 218569'
  return sectionBlock({
    id: 'data.snp',
    title: 'Reading the Site Frequency Spectrum',
    order,
    lines: [
      `obs_sfs = [ ${values} ]`,
      'N_IND = 2*abs(obs_sfs.size()-1)',
      'N_SITES = round(sum(obs_sfs))',
    ],
    provides: ['data.snp'],
    variables: [{ name: 'obs_sfs', kind: 'constant' }],
  })
}

export function dataChromosomeBlock({ file, maxChromosome, order = 100 }) {
  return sectionBlock({
    id: 'data.chromosome',
    title: 'Reading Chromosome Counts',
    order,
    lines: [
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
      `max_chromo = ${maxChromosome}`,
      `chromo_data = readCharacterDataDelimited(${JSON.stringify(file)}, stateLabels=(max_chromo + 1), type="NaturalNumbers", delimiter="\\t", header=FALSE)`,
    ],
    provides: ['data.chromosome'],
    variables: [{ name: 'chromo_data', kind: 'constant' }],
  })
}

export function substitutionDNABlock({ model = 'JC', gamma = null, invariant = null, order = 200 }) {
  const upper = String(model).toUpperCase()
  const lines = ['moves    = VectorMoves()', 'monitors = VectorMonitors()', '']
  let matrixType = 'DNA'
  if (upper === 'JC') {
    lines.push('# Jukes-Cantor rate matrix', 'Q <- fnJC(4)', '')
  } else {
    if (['F81', 'HKY', 'GTR'].includes(upper)) {
      lines.push('pi_prior <- v(1,1,1,1)', 'pi ~ dnDirichlet(pi_prior)', 'moves.append( mvBetaSimplex(pi, weight=2) )', '')
    }
    if (['K80', 'HKY'].includes(upper)) {
      lines.push('kappa ~ dnLognormal(0.0, 1.0)', 'moves.append( mvScale(kappa, weight=1) )', '')
    }
    if (upper === 'GTR') {
      lines.push('er_prior <- v(1,1,1,1,1,1)', 'er ~ dnDirichlet(er_prior)', 'moves.append( mvBetaSimplex(er, weight=3) )', '')
    }
    const call = upper === 'F81' ? 'fnF81(pi)' : upper === 'K80' ? 'fnK80(kappa)' : upper === 'HKY' ? 'fnHKY(kappa, pi)' : 'fnGTR(er, pi)'
    lines.push(`Q := ${call}`, '')
  }
  if (gamma !== null && gamma !== false) {
    lines.push('alpha ~ dnUniform(0.0, 10.0)', 'moves.append( mvScale(alpha, weight=2) )', `site_rates := fnDiscretizeGamma(alpha, alpha, ${Number(gamma.categories ?? 4)})`, '')
  }
  if (invariant !== null && invariant !== false) {
    lines.push('p_inv ~ dnBeta(1.0, 1.0)', 'moves.append( mvSlide(p_inv, weight=1) )', '')
  }
  return sectionBlock({
    id: 'substitution.dna',
    title: 'Substitution Model',
    order,
    lines,
    provides: ['substitution.dna'],
    moves: [{ name: 'pi' }, { name: 'kappa' }, { name: 'er' }],
    variables: [{ name: 'Q', kind: 'deterministic' }],
    capabilities: [`substitution.dna.${upper}`],
  })
}

export function substitutionMorphBlock({ model = 'Mk', stateCount = 2, gamma = null, coding = null, order = 200 }) {
  const lines = ['moves    = VectorMoves()', 'monitors = VectorMonitors()']
  if (model === 'Mkv') {
    lines.push(`Q <- fnJC(${stateCount})`, '', '# Mkv: condition on observing only variable characters', `coding <- ${JSON.stringify(coding ?? 'variable')}`)
  } else {
    lines.push(`# Mk rate matrix with ${stateCount} states`, `Q <- fnJC(${stateCount})`)
  }
  lines.push('')
  if (gamma !== null && gamma !== false) {
    lines.push('alpha ~ dnExponential(1.0)', 'moves.append( mvScale(alpha, weight=5.0) )', `site_rates := fnDiscretizeGamma(alpha, alpha, ${Number(gamma.categories ?? 4)})`, '')
  }
  return sectionBlock({
    id: 'substitution.morph',
    title: 'Morphological Substitution Model',
    order,
    lines,
    provides: ['substitution.morph'],
    variables: [{ name: 'Q', kind: 'deterministic' }],
    capabilities: [`substitution.morph.${model}`],
  })
}

export function rateVariationBlock({ gamma = null, invariant = null, order = 250 }) {
  const lines = []
  if (gamma !== null) {
    lines.push(`alpha ~ dnUniform(0.0, 10.0)`, 'moves.append( mvScale(alpha, weight=2) )', `site_rates := fnDiscretizeGamma(alpha, alpha, ${Number(gamma.categories ?? 4)})`, '')
  }
  if (invariant !== null) {
    lines.push('p_inv ~ dnBeta(1.0, 1.0)', 'moves.append( mvSlide(p_inv, weight=1) )', '')
  }
  return sectionBlock({
    id: 'rate.variation',
    title: 'Among-Site Rate Variation',
    order,
    lines,
    provides: ['rate.variation'],
  })
}

export function treeUniformBlock({ outgroup = null, name = 'tree', order = 300 }) {
  const lines = []
  if (outgroup !== null && outgroup.length > 0) {
    lines.push(`out_group = clade(${outgroup.map((taxon) => JSON.stringify(taxon)).join(', ')})`, `${name} ~ dnUniformTopology(taxa, outgroup=out_group)`)
  } else {
    lines.push(`${name} ~ dnUniformTopology(taxa)`)
  }
  lines.push(`moves.append( mvNNI(${name}, weight=num_taxa/2.0) )`, `moves.append( mvSPR(${name}, weight=num_taxa/10.0) )`, '')
  const priorLine = 'bl[i] ~ dnExponential(10.0)'
  lines.push('# Branch lengths', 'for (i in 1:num_branches) {', `    ${priorLine}`, '    moves.append( mvScale(bl[i], weight=1) )', '}', '', `psi := fnTreeAssembly(${name}, bl)`, '')
  return sectionBlock({
    id: 'tree.uniform',
    title: 'Tree Model',
    order,
    lines,
    requires: ['data.character'],
    provides: ['tree.uniform'],
    variables: [{ name: 'psi', kind: 'deterministic' }],
  })
}

export function treeFixedBlock({ file, treetype = 'non-clock', name = 'tree', order = 300, taxaExpression = null }) {
  const lines = []
  if (taxaExpression !== null) lines.push(taxaExpression)
  lines.push(`${name} <- readTrees(${JSON.stringify(file)}, treetype=${JSON.stringify(treetype)})[1]`)
  return sectionBlock({
    id: 'tree.fixed',
    title: 'Tree Model',
    order,
    lines,
    provides: ['tree.fixed'],
    variables: [{ name, kind: 'constant' }],
  })
}

export function treeClockBlock({ clock = 'strict', treeName = 'timetree', nBranches = 'n_branches', order = 320 }) {
  const lines = []
  if (clock === 'strict') {
    lines.push('clock_rate ~ dnExponential(1.0)', 'moves.append( mvScale(clock_rate, weight=3.0) )', `branch_rates := rep(clock_rate, ${nBranches})`)
  } else {
    lines.push(
      'branch_rates_mean ~ dnExponential(10.0)',
      'moves.append( mvScale(branch_rates_mean, lambda=0.5, tune=true, weight=3.0) )',
      'ln_branch_rates_mean := ln(branch_rates_mean)',
      'branch_rates_sd ~ dnUniform(0.0, 4*0.587405)',
      'moves.append( mvScale(branch_rates_sd, lambda=0.5, tune=true, weight=3.0) )',
      `for (i in 1:${nBranches}) {`,
      '    branch_rates[i] ~ dnLognormal(ln_branch_rates_mean, sd=branch_rates_sd)',
      '    moves.append( mvScale(branch_rates[i], lambda=0.5, tune=true, weight=1.0) )',
      '}',
      'moves.append( mvVectorScale(branch_rates, lambda=0.5, tune=true, weight=4.0) )',
    )
  }
  return sectionBlock({
    id: 'tree.clock',
    title: 'Clock Model',
    order,
    lines,
    provides: ['tree.clock'],
    variables: [{ name: 'branch_rates', kind: 'stochastic' }],
  })
}

export function treeBirthDeathBlock({ treeName = 'timetree', taxa = 'taxa', order = 310 }) {
  return sectionBlock({
    id: 'tree.birthdeath',
    title: 'Birth-Death Tree Prior',
    order,
    lines: [
      'birth_rate ~ dnUniform(0, 100.0)',
      'death_rate ~ dnUniform(0, 100.0)',
      'moves.append( mvScale(birth_rate, lambda=1.0, tune=true, weight=3.0) )',
      'moves.append( mvScale(death_rate, lambda=1.0, tune=true, weight=3.0) )',
      'diversification := birth_rate - death_rate',
      'rel_extinction := death_rate / birth_rate',
      `root_time <- ${treeName}.rootAge()`,
      `sampling <- ${treeName}.ntips() / ${treeName}.ntips()`,
      `${treeName} ~ dnBDP(lambda=birth_rate, mu=death_rate, rho=sampling, rootAge=root_time, samplingStrategy="uniform", condition="survival", taxa=${taxa})`,
      `${treeName}.clamp(${treeName}_observed)`,
    ],
    provides: ['tree.birthdeath'],
    variables: [{ name: treeName, kind: 'stochastic' }],
  })
}

export function treeFBDBlock({ taxa = 'taxa', origin = 'origin_time', order = 310 }) {
  const lines = [
    'speciation_rate ~ dnExponential(10.0)',
    'extinction_rate ~ dnExponential(10.0)',
    'psi ~ dnExponential(10.0)',
    'moves.append( mvScale(speciation_rate, weight=1) )',
    'moves.append( mvScale(extinction_rate, weight=1) )',
    'moves.append( mvScale(psi, weight=1) )',
    `origin_time ~ dnUnif(${origin.includes('origin_time') ? '0.0, 100.0' : origin})`,
    'moves.append( mvSlide(origin_time, weight=1.0) )',
    'rho <- 1.0',
    `fbd_tree ~ dnFBDP(origin=origin_time, lambda=speciation_rate, mu=extinction_rate, psi=psi, rho=rho, taxa=${taxa})`,
    'moves.append( mvFNPR(fbd_tree, weight=15.0) )',
    'moves.append( mvCollapseExpandFossilBranch(fbd_tree, origin_time, weight=6.0) )',
    'moves.append( mvNodeTimeSlideUniform(fbd_tree, weight=40.0) )',
    'moves.append( mvRootTimeSlideUniform(fbd_tree, origin_time, weight=5.0) )',
    'num_samp_anc := fbd_tree.numSampledAncestors()',
  ]
  return sectionBlock({
    id: 'tree.fbd',
    title: 'Fossilized Birth-Death Tree Prior',
    order,
    lines,
    provides: ['tree.fbd'],
    variables: [{ name: 'fbd_tree', kind: 'stochastic' }],
  })
}

export function calibrationBlock({ calibrations = [], order = 330 }) {
  const lines = ['# Node calibrations']
  for (const calibration of calibrations) {
    lines.push(`${calibration.name} ~ dnUniform(${calibration.min}, ${calibration.max})`, `moves.append( mvSlide(${calibration.name}, weight=1) )`)
  }
  return sectionBlock({
    id: 'calibration',
    title: 'Calibrations',
    order,
    lines,
    provides: ['calibration'],
  })
}

export function demographySkylineBlock({ model = 'constant', order = 320 }) {
  const lines = []
  if (model === 'constant') {
    lines.push('theta ~ dnLoguniform(1e-5, 1e5)', 'moves.append( mvScale(theta, weight=2) )', 'coalescent_pop_size := theta / 4.0')
  } else if (model === 'skyline') {
    lines.push('theta ~ dnLoguniform(1e-5, 1e5)', 'moves.append( mvScale(theta, weight=2) )')
  } else {
    lines.push('theta ~ dnLoguniform(1e-5, 1e5)', 'moves.append( mvScale(theta, weight=2) )')
  }
  return sectionBlock({
    id: 'demography.skyline',
    title: 'Demographic Model',
    order,
    lines,
    provides: ['demography.skyline'],
  })
}

export function asrBlock({ treeName = 'timetree', type = 'Standard', order = 700 }) {
  return sectionBlock({
    id: 'asr',
    title: 'Ancestral State Reconstruction',
    order,
    lines: [
      'monitors.append( mnJointConditionalAncestralState(',
      `    tree=${treeName},`,
      '    ctmc=seq,',
      `    type=${JSON.stringify(type)},`,
      '    withTips=true,',
      '    withStartStates=true,',
      '    filename=output_prefix + ".anc_states.log",',
      '    printgen=10) )',
    ],
    provides: ['asr'],
  })
}

export function partitionBlock({ partitions, order = 110 }) {
  const lines = ['# Partitioned data', 'partitions = []']
  for (const partition of partitions) {
    lines.push(`partitions.append( readDiscreteCharacterData(${JSON.stringify(partition.file)}) )`)
  }
  lines.push('num_partitions = partitions.size()', 'for (i in 1:num_partitions) {', '    taxa[i] = partitions[i].taxa()', '}')
  return sectionBlock({
    id: 'partition',
    title: 'Partitioned Data',
    order,
    lines,
    provides: ['partition'],
  })
}

export function monitorBlock({ prefix, sampleEvery = 10, screenEvery = 100, treeName = null, order = 800 }) {
  const lines = [
    `monitors.append( mnModel(filename=${JSON.stringify(`${prefix}.log`)}, printgen=${sampleEvery}) )`,
  ]
  if (treeName !== null) lines.push(`monitors.append( mnFile(filename=${JSON.stringify(`${prefix}.trees`)}, printgen=${sampleEvery}, ${treeName}) )`)
  lines.push(`monitors.append( mnScreen(printgen=${screenEvery}) )`)
  return sectionBlock({
    id: 'monitors',
    title: 'Monitors',
    order,
    lines,
    provides: ['monitors'],
  })
}

export function mcmcBlock({ generations, tuningInterval = 100, nruns = 1, combine = 'mixed', moveschedule = 'random', order = 900 }) {
  const args = ['model=mymodel', 'monitors=monitors', 'moves=moves', `moveschedule=${JSON.stringify(moveschedule)}`]
  if (nruns > 1) args.push(`nruns=${nruns}`, `combine=${JSON.stringify(combine)}`)
  return sectionBlock({
    id: 'mcmc',
    title: 'MCMC Analysis',
    order,
    lines: [
      'mymodel = model(mymodel_anchor)',
      '',
      `mymcmc = mcmc(${args.join(', ')})`,
      `mymcmc.run(generations=${generations}, tuningInterval=${tuningInterval})`,
      'mymcmc.operatorSummary()',
      '',
      '# Quit RevBayes after the analysis',
      'q()',
    ],
    provides: ['mcmc'],
  })
}

/** Create a family-specific block without registering it globally. */
export function familyBlock(definition) {
  return makeBlock(definition)
}
