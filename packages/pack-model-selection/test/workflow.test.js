import test from 'node:test'
import assert from 'node:assert/strict'
import { validateScript } from 'dsh-revbayes-forge'
import { createMockContext, createTestingForge } from 'dsh-revbayes-forge/testing'
import manifest from '../src/manifest.js'
import { manifest as fbd } from '../../pack-fbd/src/manifest.js'

function setup() {
  const { forge, catalog } = createTestingForge({ enabledPacks: ['fbd', 'model-selection'] })
  const ctx = createMockContext()
  forge.registerPack(fbd, ctx).enable()
  forge.registerPack(manifest, ctx).enable()
  return { forge, catalog }
}

test('model selection resolves base_spec and emits both estimators', () => {
  const { forge, catalog } = setup()
  const result = manifest.generate({
    analysis: 'marginal_likelihood',
    name: 'marginal_from_spec',
    base_spec: {
      pack: 'fbd',
      analysis: 'fbd',
      data: { file: 'data/bears_morphology.nex', taxa_file: 'data/bears_taxa.tsv', matrix_file: 'data/bears_morphology.nex' },
      substitution: { model: 'Mk' },
      fbd: { lambda: 1.0, mu: 0.2, psi: 0.1, rho: 1.0, origin: 45.0 },
      mcmc: { generations: 1000 },
    },
    cats: 10,
    burnin: 100,
    generations: 100,
  }, { forge, catalog, config: {} })
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
  assert.match(result.script, /dnFBDP/)
  assert.match(result.script, /steppingStoneSampler/)
  assert.match(result.script, /pathSampler/)
  const validation = validateScript(result.script, { catalog, checkFiles: false, strict: true })
  assert.equal(validation.summary.error, 0)
})

test('model selection reports missing base pack', () => {
  const { forge, catalog } = createTestingForge({ enabledPacks: ['model-selection'] })
  const ctx = createMockContext()
  forge.registerPack(manifest, ctx).enable()
  const result = manifest.generate({
    analysis: 'stepping_stone',
    base_spec: { pack: 'fbd', analysis: 'fbd', data: { file: 'x.nex' } },
  }, { forge, catalog, config: {} })
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'SEL1007'))
})
