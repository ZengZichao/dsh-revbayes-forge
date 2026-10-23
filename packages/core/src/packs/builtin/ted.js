/**
 * pack-ted — total-evidence dating orchestrator. It composes the FBD base
 * script through core.generateByPack (never imports pack-fbd), checks the
 * dating dependency with a recipe, and appends TED integration monitors.
 */
import {
  definePack,
  buildPackScript,
  normalizeBaseSpec,
  normalizeMcmc,
  asString,
  asInteger,
  optionalObject,
  PackSpecError,
  sanitizeName,
} from '../spec.js'

const SOURCE = 'pack:ted'
const ANALYSES = ['ted', 'ted_range']

function normalize(spec, ctx) {
  const base = normalizeBaseSpec(spec, {
    source: 'ted',
    code: 'TED1001',
    analyses: ANALYSES,
    defaultAnalysis: 'ted',
    requireDataFile: false,
  })
  const baseSpec = optionalObject(spec.base_spec, 'base_spec', 'TED1002')
  const baseAnalysis = asString(baseSpec.analysis, 'base_spec.analysis', { code: 'TED1003', defaultValue: base.analysis === 'ted_range' ? 'fbd_range' : 'fbd', enumValues: ['fbd', 'fbd_simple', 'fbd_range'] })
  const extantTaxa = Array.isArray(spec.extant_taxa) ? spec.extant_taxa.map((item) => String(item)) : []
  const calibrations = Array.isArray(spec.calibrations) ? spec.calibrations : []
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'TED1004', defaultGenerations: 30000 })
  const name = sanitizeName(spec.name ?? `ted_${base.analysis}`, 'ted_workflow')
  if (ctx.forge === undefined || ctx.forge === null) {
    throw new PackSpecError('TED1005', 'TED requires the revbayesForge service to compose the FBD base script.', 'base_spec')
  }
  const recipe = ctx.forge.assembly.recipe('ted')
  recipe.requirePack('fbd', '>=0.1.0')
  recipe.requirePack('dating', '>=0.1.0')
  const checked = recipe.check()
  if (!checked.ok) throw new PackSpecError('TED1006', checked.diagnostics.map((item) => item.message).join('; '), 'base_spec')
  const generated = ctx.forge.generateByPack('fbd', baseAnalysis, {
    ...baseSpec,
    analysis: baseAnalysis,
    name: `${name}_fbd`,
    mcmc: spec.mcmc ?? baseSpec.mcmc,
  }, ctx)
  if (!generated.ok) {
    throw new PackSpecError('TED1007', `FBD base generation failed: ${generated.diagnostics.map((item) => item.message).join('; ')}`, 'base_spec')
  }
  return { ...base, name, baseAnalysis, baseScript: generated.script, extantTaxa, calibrations, mcmc }
}

function renderTed(spec) {
  let base = spec.baseScript.replace(/\n?q\(\)\s*;?\s*$/m, '').trimEnd()
  const marker = /\nmymcmc\s*=\s*mcmc\(/m
  const match = marker.exec(base)
  if (match !== null) base = base.slice(0, match.index).trimEnd()
  const calibrationNames = []
  const calibrationLines = []
  for (const calibration of spec.calibrations) {
    if (calibration === null || typeof calibration !== 'object') continue
    const name = sanitizeName(calibration.name ?? 'calibration', 'calibration')
    const min = Number(calibration.min ?? 0)
    const max = Number(calibration.max ?? 1)
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      calibrationNames.push(name)
      calibrationLines.push(`${name} ~ dnUniform(${min}, ${max})`, `moves.append( mvSlide(${name}, weight=1) )`)
    }
  }
  if (calibrationNames.length > 0) {
    base = base.replace(/(^mymodel\s*=\s*model\([^\n]*\)$)/m, `${calibrationLines.join('\n')}\n$1`)
    base = base.replace(/mymodel\s*=\s*model\(([^)]*)\)/, (_match, args) => `mymodel = model(${args.trim()}, ${calibrationNames.join(', ')})`)
  }
  const lines = [base, '', '# TED cross-family integration']
  if (spec.extantTaxa.length > 0) {
    const clade = spec.extantTaxa.map((taxon) => JSON.stringify(taxon)).join(', ')
    lines.push(`extant_clade = clade(${clade})`, 'age_extant := tmrca(fbd_tree, extant_clade)')
  }
  lines.push(
    '',
    `monitors.append( mnModel(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.log`)}, printgen=${spec.mcmc.sampleEvery}, exclude=["F"]) )`,
    `monitors.append( mnFile(filename=${JSON.stringify(`${spec.mcmc.outputDir}/${spec.name}.trees`)}, printgen=${spec.mcmc.sampleEvery}, fbd_tree) )`,
    `monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}, origin_time, num_samp_anc) )`,
    '',
    'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)',
    `mymcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
    'mymcmc.operatorSummary()',
    '',
    '# Dating sensitivity summary: the TED model shares the FBD tree with the',
    '# morphological clock from the base analysis.',
    'q()',
  )
  const script = lines.join('\n')
  return {
    script,
    primary_script: script,
    artifacts: [
      { role: 'main', name: `${spec.name}.Rev`, script },
      { role: 'base', name: `${spec.name}_fbd_base.Rev`, script: spec.baseScript },
    ],
    sections: [
      { name: 'FBD base analysis', startLine: 1, endLine: base.split('\n').length },
      { name: 'TED integration and MCMC', startLine: base.split('\n').length + 2, endLine: script.split('\n').length },
    ],
    stats: { lines: script.split('\n').length, bytes: Buffer.byteLength(script, 'utf8'), moves: (script.match(/moves\.append\(/g) ?? []).length, monitors: (script.match(/monitors\.append\(/g) ?? []).length },
  }
}

export const manifest = definePack({
  id: 'ted',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'verified',
  title: 'Total Evidence Dating',
  description: 'TED orchestrator that composes the FBD base analysis with dating clocks, extant-clade calibration, and combined monitors.',
  analyses: [
    { id: 'ted', title: 'TED', maturity: 'verified' },
    { id: 'ted_range', title: 'TED with ranges', maturity: 'verified' },
  ],
  tools: [{
    name: 'revbayes_generate_ted',
    description: 'Generate a total-evidence dating workflow by composing the FBD base analysis with dating integration.',
    specDescription: 'TED spec with base_spec for FBD, extant taxa, optional calibrations, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'TED variant.' },
      name: { type: 'string', description: 'Base name for outputs.' },
      base_spec: { type: 'object', description: 'FBD base spec.', properties: { analysis: { type: 'string', enum: ['fbd', 'fbd_simple', 'fbd_range'] }, data: { type: 'object' }, substitution: { type: 'object' }, fbd: { type: 'object' }, mcmc: { type: 'object' } } },
      extant_taxa: { type: 'array', items: { type: 'string' }, description: 'Extant taxa for the clade-age summary.' },
      calibrations: { type: 'array', items: { type: 'object' }, description: 'Optional calibration priors.' },
      mcmc: { type: 'object', description: 'MCMC settings.' },
    }),
  }],
  dependencies: [{ pack: 'fbd', minVersion: '0.1.0' }, { pack: 'dating', minVersion: '0.1.0' }],
  blocks: ['data.fossil', 'data.character', 'substitution.morph', 'tree.fbd', 'tree.clock', 'calibration', 'monitors', 'mcmc'],
  generate(spec, ctx = {}) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize: (raw) => normalize(raw, ctx),
      render: renderTed,
    })
  },
  validateSpec(spec, ctx = {}) {
    return manifest.generate(spec, ctx).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 10, fixtures: ['fixtures/ted'] },
})

export default manifest
