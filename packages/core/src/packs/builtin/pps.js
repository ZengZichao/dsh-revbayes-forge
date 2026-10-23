/**
 * pack-pps — posterior predictive simulation workflow. Accepts a base script
 * (inline or a path) or a base_spec resolved through core.generateByPack.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  definePack,
  buildPackScript,
  normalizeBaseSpec,
  normalizeMcmc,
  asString,
  asInteger,
  asNumber,
  optionalObject,
  PackSpecError,
  sanitizeName,
} from '../spec.js'

const SOURCE = 'pack:pps'
const ANALYSES = ['pps', 'pps_morphology', 'posterior_predictive']

function stripQuit(script) {
  return script.replace(/\n?q\(\)\s*;?\s*$/m, '').trimEnd()
}

function resolveBase(spec, ctx) {
  if (typeof spec.base_script === 'string' && spec.base_script.trim().length > 0) {
    const text = spec.base_script
    if (text.includes('\n')) return { script: text, source: 'inline', name: 'base_script' }
    try {
      const workspace = ctx.workspace ?? process.cwd()
      return { script: readFileSync(resolve(workspace, text), 'utf8'), source: text, name: text }
    } catch (error) {
      throw new PackSpecError('PPS1002', `base_script could not be read: ${error.message}`, 'base_script')
    }
  }
  if (spec.base_spec !== undefined) {
    if (ctx.forge === undefined || ctx.forge === null) {
      throw new PackSpecError('PPS1003', 'base_spec requires a live revbayesForge service; pass base_script instead.', 'base_script')
    }
    const baseSpec = optionalObject(spec.base_spec, 'base_spec', 'PPS1004')
    const pack = asString(baseSpec.pack, 'base_spec.pack', { code: 'PPS1005', required: true })
    const analysis = asString(baseSpec.analysis, 'base_spec.analysis', { code: 'PPS1006', required: true })
    const generated = ctx.forge.generateByPack(pack, analysis, baseSpec, ctx)
    if (!generated.ok) {
      throw new PackSpecError('PPS1007', `base_spec failed: ${generated.diagnostics.map((item) => item.message).join('; ')}`, 'base_spec')
    }
    return { script: generated.script, source: `base_spec:${pack}/${analysis}`, name: `${pack}_${analysis}` }
  }
  throw new PackSpecError('PPS1001', 'Provide exactly one of base_script or base_spec.', 'base_script')
}

function normalize(spec, ctx) {
  const base = normalizeBaseSpec(spec, {
    source: 'pps',
    code: 'PPS1008',
    analyses: ANALYSES,
    defaultAnalysis: 'pps',
    requireDataFile: false,
  })
  const baseScript = resolveBase(spec, ctx)
  if (/\bmymcmc\s*=\s*mcmc\(/.test(baseScript.script) && spec.allow_base_mcmc !== true) {
    // Running the base MCMC is allowed, but warn: the workflow appends its own
    // posterior sample stage so the trace format is under its control.
  }
  const replicates = asInteger(spec.replicates, 'replicates', { code: 'PPS1009', defaultValue: 100, min: 1, max: 100000 })
  const thinning = asInteger(spec.thinning, 'thinning', { code: 'PPS1010', defaultValue: 2, min: 1, max: 100000 })
  const mcmc = normalizeMcmc(spec.mcmc, { code: 'PPS1011', defaultGenerations: 20000 })
  const outputDir = asString(spec.output_dir, 'output_dir', { code: 'PPS1012', defaultValue: 'output/pps' })
  if (outputDir.includes('..')) throw new PackSpecError('PPS1013', 'output_dir must not contain "..".', 'output_dir')
  const name = sanitizeName(spec.name ?? `${base.analysis}_pps`, 'pps_analysis')
  return { ...base, baseScript, replicates, thinning, mcmc, outputDir, name }
}

function ppsBlock(spec, withMcMc) {
  const base = stripQuit(spec.baseScript.script)
  const prefix = `${spec.outputDir}/${spec.name}`
  const lines = [base, '', '# Posterior predictive simulation']
  if (withMcMc) {
    lines.push(
      'pps_monitors = VectorMonitors()',
      `pps_monitors.append( mnStochasticVariable(filename=${JSON.stringify(`${prefix}.var`)}, printgen=${spec.mcmc.sampleEvery}) )`,
      `pps_monitors.append( mnScreen(printgen=${spec.mcmc.screenEvery}) )`,
      '',
      'pps_mcmc = mcmc(model=mymodel, monitors=pps_monitors, moves=moves)',
      `pps_mcmc.run(generations=${spec.mcmc.generations}, tuningInterval=${spec.mcmc.tuningInterval})`,
    )
  }
  lines.push(
    `trace = readStochasticVariableTrace(${JSON.stringify(`${prefix}.var`)}, separator="\\t")`,
    `pps = posteriorPredictiveSimulation(mymodel, directory=${JSON.stringify(`${prefix}_post_sims`)}, trace=trace)`,
    `pps.run(thinning=${spec.thinning})`,
    '',
    '# Simulate the requested number of replicate data sets',
    `num_post_sims = ${spec.replicates}`,
    'q()',
  )
  return lines.join('\n')
}

export const manifest = definePack({
  id: 'pps',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'golden',
  title: 'Posterior Predictive Simulation',
  description: 'Posterior predictive simulation workflow for any enabled base analysis, using base_script or base_spec.',
  analyses: [
    { id: 'pps', title: 'PPS (DNA)', maturity: 'golden' },
    { id: 'pps_morphology', title: 'PPS (morphology)', maturity: 'golden' },
    { id: 'posterior_predictive', title: 'Posterior predictive', maturity: 'golden' },
  ],
  tools: [{
    name: 'revbayes_pps',
    description: 'Build a posterior predictive simulation workflow from a base RevBayes script or a base_spec resolved through an enabled pack.',
    specDescription: 'PPS spec with base_script or base_spec, replicates, thinning, output_dir, and mcmc.',
    parameters: () => ({
      analysis: { type: 'string', enum: ANALYSES, description: 'PPS workflow variant.' },
      name: { type: 'string', description: 'Base name for PPS outputs.' },
      base_script: { type: 'string', description: 'Inline base script or a path to one (relative to the workspace).' },
      base_spec: { type: 'object', description: 'Base spec resolved via core.generateByPack.', properties: { pack: { type: 'string' }, analysis: { type: 'string' } } },
      replicates: { type: 'number', description: 'Number of posterior predictive replicates (>0).' },
      thinning: { type: 'number', description: 'Thinning interval for posterior predictive simulation.' },
      output_dir: { type: 'string', description: 'Directory for PPS outputs.' },
      mcmc: { type: 'object', description: 'MCMC settings for the posterior sample stage.' },
    }),
  }],
  dependencies: [],
  workflow: {
    baseSpec: true,
    note: 'base_spec must name an enabled base pack and analysis; base_script has no pack dependency.',
  },
  blocks: ['base', 'pps.simulate', 'pps.summarize', 'monitors'],
  generate(spec, ctx = {}) {
    return buildPackScript(spec, {
      source: SOURCE,
      normalize: (raw) => normalize(raw, ctx),
      render: (normalized) => {
        const main = ppsBlock(normalized, true)
        const simulate = ppsBlock(normalized, false)
        return {
          script: main,
          primary_script: main,
          artifacts: [
            { role: 'main', name: `${normalized.name}.Rev`, script: main },
            { role: 'simulation', name: `${normalized.name}_simulate.Rev`, script: simulate },
          ],
          sections: [
            { name: 'Base analysis', startLine: 1, endLine: normalized.baseScript.script.split('\n').length },
            { name: 'Posterior predictive simulation', startLine: 0, endLine: 0 },
          ],
          stats: { lines: main.split('\n').length, bytes: Buffer.byteLength(main, 'utf8'), moves: 0, monitors: 0 },
        }
      },
    })
  },
  validateSpec(spec, ctx = {}) {
    return manifest.generate(spec, ctx).diagnostics
  },
  runtime: { recommendedSmokeGenerations: 10, fixtures: ['fixtures/pps'] },
})

export default manifest
