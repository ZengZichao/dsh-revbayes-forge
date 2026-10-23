/**
 * pack-model-selection — stepping-stone and path-sampling marginal likelihood
 * workflow over a base analysis (base_script or base_spec).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  definePack,
  buildPackScript,
  normalizeBaseSpec,
  asString,
  asInteger,
  optionalObject,
  PackSpecError,
  sanitizeName,
} from '../spec.js'

const SOURCE = 'pack:model-selection'
const ANALYSES = ['stepping_stone', 'path_sampling', 'marginal_likelihood']

function stripQuit(script) {
  return script.replace(/\n?q\(\)\s*;?\s*$/m, '').trimEnd()
}

function resolveBase(spec, ctx) {
  if (typeof spec.base_script === 'string' && spec.base_script.trim().length > 0) {
    const text = spec.base_script
    if (text.includes('\n')) return { script: text, source: 'inline' }
    try {
      return { script: readFileSync(resolve(ctx.workspace ?? process.cwd(), text), 'utf8'), source: text }
    } catch (error) {
      throw new PackSpecError('SEL1002', `base_script could not be read: ${error.message}`, 'base_script')
    }
  }
  if (spec.base_spec !== undefined) {
    if (ctx.forge === undefined || ctx.forge === null) {
      throw new PackSpecError('SEL1003', 'base_spec requires a live revbayesForge service; pass base_script instead.', 'base_script')
    }
    const baseSpec = optionalObject(spec.base_spec, 'base_spec', 'SEL1004')
    const pack = asString(baseSpec.pack, 'base_spec.pack', { code: 'SEL1005', required: true })
    const analysis = asString(baseSpec.analysis, 'base_spec.analysis', { code: 'SEL1006', required: true })
    const generated = ctx.forge.generateByPack(pack, analysis, baseSpec, ctx)
    if (!generated.ok) throw new PackSpecError('SEL1007', `base_spec failed: ${generated.diagnostics.map((item) => item.message).join('; ')}`, 'base_spec')
    return { script: generated.script, source: `base_spec:${pack}/${analysis}` }
  }
  throw new PackSpecError('SEL1001', 'Provide exactly one of base_script or base_spec.', 'base_script')
}

function normalize(spec, ctx) {
  const base = normalizeBaseSpec(spec, {
    source: 'selection',
    code: 'SEL1008',
    analyses: ANALYSES,
    defaultAnalysis: 'stepping_stone',
    requireDataFile: false,
  })
  const baseScript = resolveBase(spec, ctx)
  const method = base.analysis === 'marginal_likelihood' ? 'both' : base.analysis
  const cats = asInteger(spec.cats ?? spec.steps, 'cats', { code: 'SEL1009', defaultValue: 50, min: 2, max: 1000 })
  const burnin = asInteger(spec.burnin, 'burnin', { code: 'SEL1010', defaultValue: 1000, min: 1, max: 1e9 })
  const steps = asInteger(spec.generations ?? spec.steps, 'generations', { code: 'SEL1011', defaultValue: 1000, min: 1, max: 1e9 })
  const sampleFreq = asInteger(spec.sample_freq, 'sample_freq', { code: 'SEL1012', defaultValue: 10, min: 1, max: 1e9 })
  const outputDir = asString(spec.output_dir, 'output_dir', { code: 'SEL1013', defaultValue: 'output/model_selection' })
  if (outputDir.includes('..')) throw new PackSpecError('SEL1014', 'output_dir must not contain "..".', 'output_dir')
  const name = sanitizeName(spec.name ?? `model_selection_${method}`, 'model_selection')
  return { ...base, baseScript, method, cats, burnin, steps, sampleFreq, outputDir, name }
}

function renderModelSelection(spec) {
  const prefix = `${spec.outputDir}/${spec.name}`
  const lines = [
    stripQuit(spec.baseScript.script),
    '',
    '# Marginal likelihood estimation',
    `pow_p = powerPosterior(mymodel, moves, monitors, ${JSON.stringify(`${prefix}.out`)}, cats=${spec.cats}, sampleFreq=${spec.sampleFreq})`,
    `pow_p.burnin(generations=${spec.burnin}, tuningInterval=${Math.max(1, Math.min(250, spec.burnin))})`,
    `pow_p.run(generations=${spec.steps})`,
    '',
  ]
  if (spec.method === 'stepping_stone' || spec.method === 'both') {
    lines.push(
      '# Stepping-stone sampling',
      `ss = steppingStoneSampler(filename=${JSON.stringify(`${prefix}.out`)}, powerColumnName="power", likelihoodColumnName="likelihood")`,
      'ss.marginal()',
      '',
    )
  }
  if (spec.method === 'path_sampling' || spec.method === 'both') {
    lines.push(
      '# Path sampling',
      `ps = pathSampler(filename=${JSON.stringify(`${prefix}.out`)}, powerColumnName="power", likelihoodColumnName="likelihood")`,
      'ps.marginal()',
      '',
    )
  }
  lines.push('q()')
  const script = lines.join('\n')
  return {
    script,
    primary_script: script,
    artifacts: [{ role: 'main', name: `${spec.name}.Rev`, script }],
    sections: [
      { name: 'Base analysis', startLine: 1, endLine: spec.baseScript.script.split('\n').length },
      { name: 'Marginal likelihood', startLine: spec.baseScript.script.split('\n').length + 2, endLine: script.split('\n').length },
    ],
    stats: { lines: script.split('\n').length, bytes: Buffer.byteLength(script, 'utf8'), moves: 0, monitors: 0 },
  }
}

export const manifest = definePack({
  id: 'model-selection',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'golden',
  title: 'Model Selection',
  description: 'Stepping-stone and path-sampling marginal likelihood workflows for any enabled base analysis.',
  analyses: [
    { id: 'stepping_stone', title: 'Stepping-stone', maturity: 'golden' },
    { id: 'path_sampling', title: 'Path sampling', maturity: 'golden' },
    { id: 'marginal_likelihood', title: 'Marginal likelihood', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_model_selection',
    description: 'Build a stepping-stone or path-sampling marginal likelihood workflow from a base RevBayes script or base_spec.',
    specDescription: 'Model-selection spec with base_script or base_spec, method, cats, burnin, generations, output_dir.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'Marginal likelihood method.' },
      name: { type: 'string', description: 'Base name for outputs.' },
      base_script: { type: 'string', description: 'Inline base script or a path to one.' },
      base_spec: { type: 'object', description: 'Base spec resolved via core.generateByPack.', properties: { pack: { type: 'string' }, analysis: { type: 'string' } } },
      cats: { type: 'number', description: 'Number of power-posterior categories.' },
      burnin: { type: 'number', description: 'Power-posterior burn-in generations.' },
      generations: { type: 'number', description: 'Power-posterior run generations.' },
      sample_freq: { type: 'number', description: 'Sampling frequency.' },
      output_dir: { type: 'string', description: 'Output directory.' },
    }),
  }],
  dependencies: [],
  workflow: {
    baseSpec: true,
    note: 'base_spec must name an enabled base pack and analysis; base_script has no pack dependency.',
  },
  blocks: ['base', 'model_selection', 'monitors'],
  generate(spec, ctx = {}) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize: (raw) => normalize(raw, ctx),
      render: renderModelSelection,
    })
  },
  validateSpec(spec, ctx = {}) {
    return manifest.generate(spec, ctx).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 5, fixtures: ['fixtures/model-selection'] },
})

export default manifest
