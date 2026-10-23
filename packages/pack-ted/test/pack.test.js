import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog, validateScript } from 'dsh-revbayes-forge'
import { createMockContext, createTestingForge, normalizeGolden } from 'dsh-revbayes-forge/testing'
import manifest from '../src/manifest.js'
import { manifest as fbd } from '../../pack-fbd/src/manifest.js'
import { manifest as dating } from '../../pack-dating-clock/src/manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const catalog = loadCatalog()

const baseSpec = {
  analysis: 'fbd',
  data: { file: 'data/bears_morphology.nex', taxa_file: 'data/bears_taxa.tsv', matrix_file: 'data/bears_morphology.nex', type: 'Standard', state_count: 2 },
  substitution: { model: 'Mk' },
  fbd: { lambda: 1.0, mu: 0.2, psi: 0.1, rho: 1.0, origin: 45.0 },
}
const tedSpec = {
  analysis: 'ted',
  name: 'ted_demo',
  base_spec: baseSpec,
  extant_taxa: ['A', 'B', 'C'],
  calibrations: [{ name: 'root_calibration', min: 30, max: 60 }],
  mcmc: { generations: 20000, sample_every: 10 },
}

function enabledForge() {
  const { forge } = createTestingForge({ enabledPacks: ['fbd', 'dating', 'ted'] })
  const ctx = createMockContext()
  for (const pack of [fbd, dating, manifest]) {
    const registration = forge.registerPack(pack, ctx)
    const outcome = registration.enable()
    assert.equal(outcome.blocked, null, `${pack.id} blocked: ${outcome.blocked}`)
  }
  return { forge, ctx }
}

test('ted: composes FBD base and registers tool with all dependencies', () => {
  const { forge, ctx } = enabledForge()
  assert.equal(forge.listPacks().length, 3)
  assert.ok(ctx.toolsByName.has('revbayes_generate_fbd'))
  assert.ok(ctx.toolsByName.has('revbayes_generate_dating'))
  assert.ok(ctx.toolsByName.has('revbayes_generate_ted'))
  const tedView = forge.listPacks().find((pack) => pack.id === 'ted')
  assert.equal(tedView.enabled, true)
  assert.equal(tedView.blocked, null)
})

test('ted: missing dependencies block enable without half-registered tools', () => {
  const { forge } = createTestingForge({ enabledPacks: ['ted'] })
  const ctx = createMockContext()
  const registration = forge.registerPack(manifest, ctx)
  const outcome = registration.enable()
  assert.notEqual(outcome.blocked, null)
  assert.match(outcome.blocked, /fbd/)
  assert.equal(ctx.toolsByName.has('revbayes_generate_ted'), false)
})

test('ted: canonical spec matches golden and validates strictly', () => {
  const { forge } = enabledForge()
  const result = manifest.generate(tedSpec, { catalog, forge, config: {} })
  const errors = (result.diagnostics ?? []).filter((item) => item.severity === 'error')
  assert.deepEqual(errors, [])
  assert.equal(result.ok, true)
  const validation = validateScript(result.script, { catalog, checkFiles: false, strict: true })
  assert.equal(validation.summary.error, 0, JSON.stringify(validation.diagnostics.filter((item) => item.severity === 'error')))
  const golden = readFileSync(join(here, '..', 'fixtures', 'golden', 'ted.Rev'), 'utf8')
  assert.equal(normalizeGolden(result.script), normalizeGolden(golden))
  assert.equal(result.artifacts.length, 2)
})

test('ted: missing base spec and invalid analysis are rejected', () => {
  const { forge } = enabledForge()
  const missing = manifest.generate({ analysis: 'ted' }, { catalog, forge, config: {} })
  assert.equal(missing.ok, false)
  assert.ok(missing.diagnostics.some((item) => item.code === 'TED1007'))
  const bad = manifest.generate({ analysis: 'nope' }, { catalog, forge, config: {} })
  assert.equal(bad.ok, false)
  assert.ok(bad.diagnostics.some((item) => item.code === 'TED1001'))
  const blocked = manifest.generate({ analysis: 'ted' }, { catalog, config: {} })
  assert.equal(blocked.ok, false)
  assert.ok(blocked.diagnostics.some((item) => item.code === 'TED1005'))
})
