/**
 * pack-host-repertoire — host repertoire evolution with host-switch rate
 * modifiers and data-augmented character histories.
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
} from '../spec.js'

const SOURCE = 'pack:host-repertoire'

function normalize(spec) {
  const base = normalizeBaseSpec(spec, {
    source: 'host',
    code: 'HOS1001',
    analyses: ['host_repertoire'],
    defaultAnalysis: 'host_repertoire',
    requireDataFile: false,
  })
  const data = base.data
  const hostTree = asString(data.host_tree, 'data.host_tree', { code: 'HOS1002', required: true })
  const parasiteTree = asString(data.parasite_tree, 'data.parasite_tree', { code: 'HOS1003', required: true })
  const associationFile = asString(data.association_file ?? data.file, 'data.association_file', { code: 'HOS1004', required: true })
  const gainScales = Array.isArray(spec.model?.gain_scales)
    ? spec.model.gain_scales.map((value, index) => asNumber(value, `model.gain_scales[${index}]`, { code: 'HOS1005', min: 0 }))
    : [1.0, 1.0]
  const mu = asNumber(spec.model?.mu, 'model.mu', { code: 'HOS1006', defaultValue: 0.1, min: 0, exclusiveMin: true })
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'HOS1007', defaultGenerations: 20000 })
  return { ...base, hostTree, parasiteTree, associationFile, gainScales, mu, mcmc }
}

function render(spec) {
  const sections = [
    section('Reading Trees and Host Associations', 100, [
      `dat_parasite <- readDiscreteCharacterData(${JSON.stringify(spec.associationFile)})`,
      `phy_host <- readTrees(${JSON.stringify(spec.hostTree)})[1]`,
      `phy_parasite <- readTrees(${JSON.stringify(spec.parasiteTree)})[1]`,
      'n_host_tips <- phy_host.ntips()',
      'n_parasite_branches <- 2 * phy_parasite.ntips() - 2',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
    ]),
    section('Host Repertoire Model', 200, [
      'switch_rates_pos ~ dnDirichlet( [1,1,1,1] )',
      'moves.append( mvSimplex(switch_rates_pos, alpha=10, weight=2, tune=false) )',
      'switch_rate_0_to_1 := switch_rates_pos[1]',
      'switch_rate_0_to_2 := 0.0',
      'switch_rate_1_to_0 := switch_rates_pos[2]',
      'switch_rate_1_to_2 := switch_rates_pos[3]',
      'switch_rate_2_to_0 := 0.0',
      'switch_rate_2_to_1 := switch_rates_pos[4]',
      'switch_rates := v( switch_rate_0_to_1, switch_rate_0_to_2, switch_rate_1_to_0, switch_rate_1_to_2, switch_rate_2_to_0, switch_rate_2_to_1 )',
      'Q_char := fnFreeK(switch_rates, false)',
      `beta[1] ~ dnExp(1)`,
      'beta[2] := beta[1]',
      'rate_modifiers[1] := fnHostSwitchRateModifier(tree=phy_host, gainScale=beta)',
      'Q_host := fnRateGeneratorSequence(Q=Q_char, numChars=n_host_tips, rateModifiers=rate_modifiers)',
      `mu ~ dnExp(${1 / spec.mu})`,
      'rf_host <- simplex(1,1,1)',
      'm_host ~ dnPhyloCTMCDASequence(tree=phy_parasite, Q=Q_host, branchRates=mu, rootFrequencies=rf_host, nSites=n_host_tips, type="Standard")',
      'm_host.clamp(dat_parasite)',
      'moves.append( mvScale( beta[1], weight=1 ) )',
      'moves.append( mvScale(mu, weight=2) )',
      'moves.append( mvCharacterHistory(ctmc=m_host, qmap_seq=Q_host, lambda=0.2, graph="node", proposal="rejection", weight=n_parasite_branches) )',
      'moves.append( mvCharacterHistory(ctmc=m_host, qmap_seq=Q_host, lambda=0.2, graph="branch", proposal="rejection", weight=n_parasite_branches) )',
    ]),
    section('Monitors and MCMC', 800, [
      'mymodel = model(m_host)',
      '',
      `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.log`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}, mu, beta[1]) )`,
      '',
      'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)',
      `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
      'mymcmc.operatorSummary()',
      '',
      'q()',
    ]),
  ]
  return renderSections({ name: spec.name, analysis: 'host/host_repertoire', dataFile: spec.associationFile, title: 'Host repertoire evolution', sections })
}

export const manifest = definePack({
  id: 'host-repertoire',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'experimental',
  title: 'Host Repertoire',
  description: 'Host repertoire evolution with host-switch rate modifiers and data-augmented histories.',
  analyses: [
    { id: 'host_repertoire', title: 'Host repertoire', maturity: 'experimental' },
  ],
  tools: [{
    name: 'revbayes_generate_host',
    description: 'Generate a host-repertoire evolution analysis from a structured spec.',
    specDescription: 'Host repertoire spec with host/parasite trees, an association matrix, model rates, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ['host_repertoire'], description: 'Host repertoire analysis.' },
      name: { type: 'string', description: 'Base name for script and monitor files.' },
      data: { type: 'object', description: 'Trees and association matrix.', properties: { host_tree: { type: 'string' }, parasite_tree: { type: 'string' }, association_file: { type: 'string' }, file: { type: 'string' } } },
      model: { type: 'object', description: 'Host repertoire model.', properties: { gain_scales: { type: 'array', items: { type: 'number' } }, mu: { type: 'number' } } },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [],
  blocks: ['data.host', 'tree.host', 'host.repertoire', 'monitors', 'mcmc'],
  generate(spec) {
    return buildPackScript(spec, { source: SOURCE, normalize, render })
  },
  validateSpec(spec) {
    return manifest.generate(spec).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 10, fixtures: ['fixtures/host'] },
})

export default manifest
