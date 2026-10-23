/**
 * pack-molecular-selection — codon dN/dS selection and PoMo allele-frequency
 * analyses.
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

const SOURCE = 'pack:molecular-selection'
const ANALYSES = ['pomo', 'pomobalance', 'codon_selection']

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'molecular',
    code: 'MOL1001',
    analyses: ANALYSES,
    defaultAnalysis: 'codon_selection',
  })
  const data = base.data
  const treeFile = asString(spec.tree?.file, 'tree.file', { code: 'MOL1002', required: true })
  const virtualNe = asInteger(spec.model?.virtual_ne, 'model.virtual_ne', { code: 'MOL1003', defaultValue: 10, min: 2, max: 100 })
  const numStates = asInteger(spec.model?.num_states, 'model.num_states', { code: 'MOL1004', defaultValue: 10, min: 2, max: 100 })
  const kappa = asNumber(spec.model?.kappa, 'model.kappa', { code: 'MOL1005', defaultValue: 2.0, min: 0, exclusiveMin: true })
  const omega = asNumber(spec.model?.omega, 'model.omega', { code: 'MOL1006', defaultValue: 0.5, min: 0 })
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'MOL1007', defaultGenerations: 20000 })
  return { ...base, treeFile, virtualNe, numStates, kappa, omega, mcmc }
}

function renderCodon(spec) {
  const sections = [
    section('Reading Codon Data and Tree', 100, [
      `data = readDiscreteCharacterData(${JSON.stringify(spec.file)})`,
      'data_codon = data.translateCharacters("Codon")',
      'n_species <- data.ntaxa()',
      'taxa <- data.taxa()',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
      '',
      `psi <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
    ]),
    section('Codon Substitution Model', 200, [
      `kappa ~ dnLognormal(ln(${spec.kappa}), 1.0)`,
      'moves.append( mvSlide(kappa, delta=1.0, tune=true, weight=2.0) )',
      'pi ~ dnDirichlet( rep(1,4) )',
      'moves.append( mvBetaSimplex(pi, alpha=1.0, tune=true, weight=2.0) )',
      'moves.append( mvDirichletSimplex(pi, alpha=1.0, tune=true, weight=2.0) )',
      '',
      'omega_negative ~ dnBeta(1,1)',
      'moves.append( mvSlide(omega_negative, delta=1.0, tune=true, weight=2.0) )',
      'Q_negative := fnCodonHKY( omega_negative, kappa, pi )',
      '',
      'omega_neutral <- 1.0',
      'Q_neutral := fnCodonHKY( omega_neutral, kappa, pi )',
      '',
      'omega_positive ~ dnExponential(1.0, offset=1.0)',
      'moves.append( mvSlide(omega_positive, delta=1.0, tune=true, weight=2.0) )',
      'Q_positive := fnCodonHKY( omega_positive, kappa, pi )',
      '',
      'Q := [Q_negative, Q_neutral, Q_positive]',
      'seq ~ dnPhyloCTMC(tree=psi, Q=Q, siteMatrices=simplex(rep(1,Q.size())), type="Codon")',
      'seq.clamp(data_codon)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'psi', treeName: 'psi',
      extraScreen: ['omega_negative', 'omega_neutral', 'omega_positive'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: 'molecular/codon_selection', dataFile: spec.file, title: 'Codon dN/dS selection analysis', sections })
}

function renderPomo(spec, balance = false) {
  const sections = [
    section('Reading PoMo Allele-Frequency Data and Tree', 100, [
      `data_pomo <- readPoMoCountFile(${JSON.stringify(spec.file)}, virtualPopulationSize=${spec.virtualNe}, numStates=${spec.numStates})`,
      'taxa <- data_pomo.taxa()',
      'n_species <- data_pomo.ntaxa()',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
      '',
      `psi <- readTrees(${JSON.stringify(spec.treeFile)})[1]`,
    ]),
    section(balance ? 'PoMoBalance Model' : 'PoMo Model', 200, [
      'base_frequencies ~ dnDirichlet( rep(1,4) )',
      'moves.append( mvBetaSimplex(base_frequencies, weight=2) )',
      'exchange_rates ~ dnDirichlet( rep(1,6) )',
      'moves.append( mvBetaSimplex(exchange_rates, weight=2) )',
      balance ? 'Q := fnReversiblePoMo(base_frequencies, exchange_rates, virtualNe=10)' : 'Q := fnReversiblePoMo(base_frequencies, exchange_rates, virtualNe=10)',
      'seq ~ dnPhyloCTMC(tree=psi, Q=Q, type="PoMo", nSites=data_pomo.nchar())',
      'seq.clamp(data_pomo)',
    ]),
    section('Monitors and MCMC', 800, mcmcTail({
      mcmc: spec.mcmc, prefixBase: spec.name, modelNode: 'seq', treeName: 'psi',
      extraScreen: ['base_frequencies'],
    })),
  ]
  return renderSections({ name: spec.name, analysis: `molecular/${balance ? 'pomobalance' : 'pomo'}`, dataFile: spec.file, title: balance ? 'PoMoBalance analysis' : 'PoMo analysis', sections })
}

export const manifest = definePack({
  id: 'molecular-selection',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'golden',
  title: 'Molecular Selection',
  description: 'Codon dN/dS selection models and PoMo allele-frequency analyses.',
  analyses: [
    { id: 'pomo', title: 'PoMo', maturity: 'golden' },
    { id: 'pomobalance', title: 'PoMoBalance', maturity: 'golden' },
    { id: 'codon_selection', title: 'Codon selection', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_generate_molecular',
    description: 'Generate a PoMo, PoMoBalance, or codon-selection analysis from a structured spec.',
    specDescription: 'Molecular spec with codon/PoMo data, tree, model parameters, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Molecular model variant.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Codon alignment or PoMo count file.', properties: { file: { type: 'string' } } },
      tree: { type: 'object', description: 'Tree file.', properties: { file: { type: 'string' } } },
      model: { type: 'object', description: 'Model parameters.', properties: { virtual_ne: { type: 'number' }, num_states: { type: 'number' }, kappa: { type: 'number' }, omega: { type: 'number' } } },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.codon', 'data.pomo', 'substitution.codon', 'substitution.pomo', 'tree.time', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize,
      render: (normalized) => {
        if (normalized.analysis === 'codon_selection') return renderCodon(normalized)
        return renderPomo(normalized, normalized.analysis === 'pomobalance')
      },
    })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 20, fixtures: ['fixtures/molecular'] },
})

export default manifest
