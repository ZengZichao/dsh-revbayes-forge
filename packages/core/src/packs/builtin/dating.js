/**
 * pack-dating-clock — molecular dating, strict/relaxed clocks, relative
 * constraints, sequential analyses, and TimeFIG dating.
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
  asStringArray,
  optionalObject,
  PackSpecError,
} from '../spec.js'

const SOURCE = 'pack:dating'
const ANALYSES = ['strict_clock', 'relaxed_clock', 'relative_constraints', 'sequential', 'timefig_dating']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'dating',
    code: 'DAT1001',
    analyses: ANALYSES,
    defaultAnalysis: 'strict_clock',
  })
  const data = base.data
  const type = asString(data.type, 'data.type', { code: 'DAT1002', defaultValue: 'DNA', enumValues: ['DNA', 'RNA', 'Standard', 'Binary'] })
  const treeFile = asString(spec.tree?.file, 'tree.file', { code: 'DAT1003', required: true })
  const substitution = optionalObject(spec.substitution, 'substitution', 'DAT1004')
  const model = asString(substitution.model, 'substitution.model', { code: 'DAT1005', defaultValue: 'GTR', enumValues: ['JC', 'F81', 'K80', 'HKY', 'GTR', 'Mk'] })
  const gamma = asObject(substitution.gamma ?? { categories: 4 }, 'substitution.gamma', 'DAT1006')
  const gammaCategories = asInteger(gamma.categories, 'substitution.gamma.categories', { code: 'DAT1007', defaultValue: 4, min: 2, max: 20 })
  const clock = optionalObject(spec.clock, 'clock', 'DAT1008')
  const clockModel = asString(clock.model, 'clock.model', {
    code: 'DAT1009',
    defaultValue: base.analysis === 'relaxed_clock' || base.analysis === 'sequential' ? 'relaxed_lognormal' : 'strict',
    enumValues: ['strict', 'relaxed_lognormal', 'relaxed_exponential'],
  })
  const clockRate = asNumber(clock.rate, 'clock.rate', { code: 'DAT1010', defaultValue: 1.0, min: 0, exclusiveMin: true })
  let calibrations = []
  if (spec.calibrations !== undefined) {
    if (!Array.isArray(spec.calibrations)) throw new PackSpecError('DAT1011', 'calibrations must be an array.', 'calibrations')
    calibrations = spec.calibrations.map((entry, index) => {
      const calibration = asObject(entry, `calibrations[${index}]`, 'DAT1012')
      const name = asString(calibration.name, `calibrations[${index}].name`, { code: 'DAT1013', required: true })
      const min = asNumber(calibration.min, `calibrations[${index}].min`, { code: 'DAT1014', min: 0 })
      const max = asNumber(calibration.max, `calibrations[${index}].max`, { code: 'DAT1015', min: 0 })
      if (max <= min) throw new PackSpecError('DAT1016', `calibrations[${index}] requires max > min.`, `calibrations[${index}]`)
      return { name, min, max, taxon: calibration.taxon ?? null }
    })
  }
  if (base.analysis === 'relative_constraints') {
    const file = asString(spec.constraints?.file, 'constraints.file', { code: 'DAT1017', required: true })
    return { ...base, type, treeFile, model, gammaCategories, clockModel, clockRate, calibrations, constraintsFile: file, mcmc: normalizeMcmc(spec.mcmc, { code: 'DAT1018', defaultGenerations: 30000 }) }
  }
  if (base.analysis === 'timefig_dating') {
    const rangeFile = asString(spec.biogeo?.range_file, 'biogeo.range_file', { code: 'DAT1019', required: true })
    return { ...base, type, treeFile, model, gammaCategories, clockModel, clockRate, calibrations, rangeFile, areas: null, mcmc: normalizeMcmc(spec.mcmc, { code: 'DAT1020', defaultGenerations: 30000 }) }
  }
  return { ...base, type, treeFile, model, gammaCategories, clockModel, clockRate, calibrations, mcmc: normalizeMcmc(spec.mcmc, { code: 'DAT1020', defaultGenerations: 30000 }) }
}

function dataLines(spec) {
  return [
    `data <- readDiscreteCharacterData(${JSON.stringify(spec.file)})`,
    'taxa <- data.taxa()',
    'num_taxa <- data.ntaxa()',
    'num_branches <- 2 * num_taxa - 2',
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
    '',
    `timetree <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
    'n_branches <- 2 * num_taxa - 2',
  ]
}

function substitutionLines(spec) {
  if (spec.model === 'JC') {
    return [
      'Q <- fnJC(4)',
      '',
      'alpha ~ dnUniform(0.0, 10.0)',
      'moves.append( mvScale(alpha, weight=2) )',
      `site_rates := fnDiscretizeGamma(alpha, alpha, ${spec.gammaCategories})`,
    ]
  }
  const lines = []
  if (['F81', 'HKY', 'GTR'].includes(spec.model)) {
    lines.push('pi_prior <- v(1,1,1,1)', 'pi ~ dnDirichlet(pi_prior)', 'moves.append( mvBetaSimplex(pi, weight=2) )')
  }
  if (['K80', 'HKY'].includes(spec.model)) {
    lines.push('kappa ~ dnLognormal(0.0, 1.0)', 'moves.append( mvScale(kappa, weight=1) )')
  }
  if (spec.model === 'GTR') {
    lines.push('er_prior <- v(1,1,1,1,1,1)', 'er ~ dnDirichlet(er_prior)', 'moves.append( mvBetaSimplex(er, weight=3) )')
  }
  const call = spec.model === 'F81' ? 'fnF81(pi)' : spec.model === 'K80' ? 'fnK80(kappa)' : spec.model === 'HKY' ? 'fnHKY(kappa, pi)' : spec.model === 'Mk' ? 'fnJC(2)' : 'fnGTR(er, pi)'
  lines.push(`Q := ${call}`, '', 'alpha ~ dnUniform(0.0, 10.0)', 'moves.append( mvScale(alpha, weight=2) )', `site_rates := fnDiscretizeGamma(alpha, alpha, ${spec.gammaCategories})`)
  return lines
}

function clockLines(spec) {
  if (spec.clockModel === 'strict') {
    return [
      `clock_rate ~ dnExponential(${1 / spec.clockRate})`,
      'moves.append( mvScale(clock_rate, lambda=0.5, tune=true, weight=3.0) )',
      'branch_rates := rep(clock_rate, n_branches)',
    ]
  }
  return [
    'branch_rates_mean ~ dnExponential(10.0)',
    'moves.append( mvScale(branch_rates_mean, lambda=0.5, tune=true, weight=3.0) )',
    'ln_branch_rates_mean := ln( branch_rates_mean )',
    'branch_rates_sd ~ dnUniform(0.0, 4*0.587405)',
    'moves.append( mvScale(branch_rates_sd, lambda=0.5, tune=true, weight=3.0) )',
    'for (i in 1:n_branches) {',
    '    branch_rates[i] ~ dnLognormal(ln_branch_rates_mean, sd=branch_rates_sd)',
    '    moves.append( mvScale(branch_rates[i], lambda=0.5, tune=true, weight=1.0) )',
    '}',
    'moves.append( mvVectorScale(branch_rates, lambda=0.5, tune=true, weight=4.0) )',
  ]
}

function calibrationLines(spec) {
  if (spec.calibrations.length === 0) return ['# No node calibrations were supplied; the tree ages are fixed by the input tree.']
  const lines = ['# Node calibration priors']
  for (const calibration of spec.calibrations) {
    lines.push(`${calibration.name} ~ dnUniform(${calibration.min}, ${calibration.max})`, `moves.append( mvSlide(${calibration.name}, weight=1) )`)
  }
  return lines
}

function renderStandard(spec, options = {}) {
  const sections = [
    section('Reading the Data and Time Tree', 100, dataLines(spec)),
    section('Substitution Model', 200, substitutionLines(spec)),
    section('Clock Model', 300, clockLines(spec)),
    section('Calibrations', 350, calibrationLines(spec)),
    section('PhyloCTMC Model', 400, [
      `seq ~ dnPhyloCTMC(tree=timetree, Q=Q, branchRates=branch_rates, siteRates=site_rates, type=${JSON.stringify(spec.type)})`,
      'seq.clamp(data)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc,
      prefixBase: spec.name,
      modelNode: 'seq',
      treeName: 'timetree',
      extraScreen: ['clock_rate', 'alpha'],
    })),
  ]
  if (options.sequential) {
    sections.splice(5, 0, section('Sequential Bayesian Analysis', 700, [
      '# Stage 1: summarize the posterior tree sample before the second-stage analysis',
      'treetrace = readTreeTrace("' + `${spec.mcmc.outputDir}/${spec.name}.trees` + '", treetype="clock")',
      'treetrace.setBurnin(0.25)',
      'map_tree = mapTree(treetrace, "' + `${spec.mcmc.outputDir}/${spec.name}_map.tree` + '")',
    ]))
  }
  return renderSections({ name: spec.name, analysis: `dating/${spec.analysis}`, dataFile: spec.file, title: 'Molecular dating analysis', sections })
}

function renderRelative(spec) {
  const sections = [
    section('Reading the Data and Constraints', 100, [
      `data <- readDiscreteCharacterData(${JSON.stringify(spec.file)})`,
      `observed_tree <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
      'taxa <- observed_tree.taxa()',
      'num_taxa <- observed_tree.ntips()',
      'n_branches <- 2 * num_taxa - 2',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
      `constraints <- readRelativeNodeAgeConstraints(file=${JSON.stringify(spec.constraintsFile)})`,
    ]),
    section('Substitution Model', 200, substitutionLines(spec)),
    section('Tree Prior with Relative Constraints', 300, [
      'birth_rate ~ dnExponential(10.0)',
      'moves.append( mvScale(birth_rate, lambda=1.0, tune=true, weight=3.0) )',
      'root_time <- observed_tree.rootAge()',
      'psi ~ dnConstrainedNodeOrder(dnBDP(lambda=birth_rate, mu=0.0, rho=1.0, rootAge=root_time, samplingStrategy="uniform", condition="survival", taxa=taxa), constraints)',
      'psi.setValue(observed_tree)',
      'moves.append( mvNarrow(psi, weight=num_taxa/2.0) )',
      'moves.append( mvNNI(psi, weight=num_taxa/5.0) )',
      'moves.append( mvFNPR(psi, weight=num_taxa/10.0) )',
      'moves.append( mvNodeTimeSlideUniform(psi, weight=num_taxa) )',
    ]),
    section('Clock Model', 350, clockLines(spec)),
    section('PhyloCTMC Model', 400, [
      `seq ~ dnPhyloCTMC(tree=psi, Q=Q, branchRates=branch_rates, siteRates=site_rates, type=${JSON.stringify(spec.type)})`,
      'seq.clamp(data)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'seq', treeName: 'psi', extraScreen: ['branch_rates'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: `dating/${spec.analysis}`, dataFile: spec.file, title: 'Dating with relative node-age constraints', sections })
}

function renderTimefig(spec) {
  const sections = [
    section('Reading Data, Tree, and Geographic Ranges', 100, [
      `dat_range_01 = readDiscreteCharacterData(${JSON.stringify(spec.rangeFile)})`,
      'dat_range_n = formatDiscreteCharacterData(dat_range_01, "DEC")',
      'n_areas = dat_range_01.nchar()',
      `timetree <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
      'num_taxa <- timetree.ntips()',
      'n_branches <- 2 * num_taxa - 2',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
    ]),
    section('Clock Model', 200, clockLines(spec)),
    section('Time- Stratified Biogeographic Model', 300, [
      'rate_bg ~ dnLoguniform(1E-4,1E2)',
      'moves.append( mvScale(rate_bg, weight=4) )',
      'dispersal_rate <- 1.0',
      'for (i in 1:n_areas) {',
      '    for (j in 1:n_areas) {',
      '        dr[i][j] <- dispersal_rate',
      '    }',
      '}',
      'extirpation_rate ~ dnLognormal(mean=ln(1) - 0.5*0.5^2, sd=0.5)',
      'moves.append( mvScale(extirpation_rate, weight=2) )',
      'for (i in 1:n_areas) {',
      '    for (j in 1:n_areas) {',
      '        er[i][j] <- 0.0',
      '    }',
      '    er[i][i] := extirpation_rate',
      '}',
      'Q_DEC := fnDECRateMatrix(dispersalRates=dr, extirpationRates=er)',
      'P_DEC := fnDECCladoProbs(eventProbs=simplex(1,1), eventTypes=["s", "a"], numCharacters=n_areas)',
      'm_bg ~ dnPhyloCTMCClado(tree=timetree, Q=Q_DEC, cladoProbs=P_DEC, branchRates=rate_bg, type="NaturalNumbers", nSites=1)',
      'm_bg.clamp(dat_range_n)',
    ]),
    section('Monitors and MCMC', 800, [
      'mymodel = model(m_bg)',
      '',
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}, rate_bg) )`,
      `mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)`,
      `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'dating/timefig_dating', dataFile: spec.rangeFile, title: 'TimeFIG dating analysis', sections })
}

export const manifest = definePack({
  id: 'dating',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'verified',
  title: 'Dating and Clocks',
  description: 'Strict/relaxed clocks, relative node-age constraints, sequential Bayesian dating, and TimeFIG dating.',
  analyses: [
    { id: 'strict_clock', title: 'Strict clock', maturity: 'verified' },
    { id: 'relaxed_clock', title: 'Relaxed clock', maturity: 'verified' },
    { id: 'relative_constraints', title: 'Relative constraints', maturity: 'verified' },
    { id: 'sequential', title: 'Sequential Bayesian', maturity: 'verified' },
    { id: 'timefig_dating', title: 'TimeFIG dating', maturity: 'golden', requires: ['biogeo'] },
  ],
  tools: [{
    name: 'revbayes_generate_dating',
    description: 'Generate a dating analysis with a strict or relaxed clock, relative constraints, sequential stages, or TimeFIG.',
    specDescription: 'Dating spec with data, tree, substitution, clock, calibrations, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Dating analysis variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Character data.', properties: { file: { type: 'string' }, type: { type: 'string', enum: ['DNA', 'RNA', 'Standard', 'Binary'] } } },
      tree: { type: 'object', description: 'Input time tree.', properties: { file: { type: 'string' } } },
      substitution: { type: 'object', description: 'Substitution model.', properties: { model: { type: 'string', enum: ['JC', 'F81', 'K80', 'HKY', 'GTR', 'Mk'] }, gamma: { type: 'object', properties: { categories: { type: 'number' } } } } },
      clock: { type: 'object', description: 'Clock model and rate.', properties: { model: { type: 'string', enum: ['strict', 'relaxed_lognormal', 'relaxed_exponential'] }, rate: { type: 'number' } } },
      calibrations: { type: 'array', items: { type: 'object' }, description: 'Node calibration priors.' },
      constraints: { type: 'object', description: 'Relative node-age constraint file.', properties: { file: { type: 'string' } } },
      biogeo: { type: 'object', description: 'Range data for TimeFIG dating.', properties: { range_file: { type: 'string' } } },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.character', 'substitution.dna', 'tree.clock', 'calibration', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => {
        if (normalized.analysis === 'relative_constraints') return renderRelative(normalized)
        if (normalized.analysis === 'timefig_dating') return renderTimefig(normalized)
        return renderStandard(normalized, { sequential: normalized.analysis === 'sequential' })
      },
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/dating'] },
})

export default manifest
