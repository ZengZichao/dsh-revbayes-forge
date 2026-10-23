import test from 'node:test'
import assert from 'node:assert/strict'
import { validateScript } from 'dsh-revbayes-forge'
import { createMockContext, createTestingForge } from 'dsh-revbayes-forge/testing'
import manifest from '../src/manifest.js'
import { manifest as fbd } from '../../pack-fbd/src/manifest.js'

function setup() {
  const { forge, catalog } = createTestingForge({ enabledPacks: ['fbd', 'pps'] })
  const ctx = createMockContext()
  forge.registerPack(fbd, ctx).enable()
  forge.registerPack(manifest, ctx).enable()
  return { forge, catalog, ctx }
}

test('pps resolves base_spec through generateByPack', () => {
  const { forge, catalog } = setup()
  const spec = {
    analysis: 'pps',
    name: 'pps_from_spec',
    base_spec: {
      pack: 'fbd',
      analysis: 'fbd',
      data: { file: 'data/bears_morphology.nex', taxa_file: 'data/bears_taxa.tsv', matrix_file: 'data/bears_morphology.nex' },
      substitution: { model: 'Mk' },
      fbd: { lambda: 1.0, mu: 0.2, psi: 0.1, rho: 1.0, origin: 45.0 },
      mcmc: { generations: 1000 },
    },
    replicates: 10,
    mcmc: { generations: 1000 },
  }
  const result = manifest.generate(spec, { forge, catalog, config: {} })
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
  assert.match(result.script, /dnFBDP/)
  assert.match(result.script, /posteriorPredictiveSimulation/)
  const validation = validateScript(result.script, { catalog, checkFiles: false, strict: true })
  assert.equal(validation.summary.error, 0)
})

test('pps reports a missing base pack instead of silently falling back', () => {
  const { forge, catalog } = createTestingForge({ enabledPacks: ['pps'] })
  const ctx = createMockContext()
  forge.registerPack(manifest, ctx).enable()
  const result = manifest.generate({
    analysis: 'pps',
    base_spec: { pack: 'fbd', analysis: 'fbd', data: { file: 'x.nex' } },
  }, { forge, catalog, config: {} })
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'PPS1007'))
})
