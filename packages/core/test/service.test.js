import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog } from '../src/rev/catalog.js'
import { normalizeConfig } from '../src/config.js'
import { createForge, validatePackManifest } from '../src/service.js'
import { createMockContext } from '../src/testing/index.js'
import { createStateStore } from '../src/state.js'

const catalog = loadCatalog()

function mockManifest(overrides = {}) {
  return {
    id: 'mock-family',
    version: '0.1.0',
    coreApi: 1,
    maturity: 'verified',
    title: 'Mock family',
    description: 'Mock pack for lifecycle tests.',
    analyses: [{ id: 'mock_analysis', title: 'Mock', maturity: 'verified' }],
    tools: [{ name: 'revbayes_generate_mock', description: 'Generate mock analysis.' }],
    dependencies: [],
    blocks: [],
    generate(spec) {
      return {
        ok: true,
        script: 'moves = VectorMoves()\nmonitors = VectorMonitors()\nQ <- fnJC(4)\nmymodel = model(Q)\nmymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)\nmymcmc.run(generations=10)\nq()\n',
        diagnostics: [],
        sections: [{ name: 'Mock', startLine: 1, endLine: 8 }],
        stats: { lines: 8, bytes: 200, moves: 1, monitors: 1 },
        name: 'mock',
        analysis: 'mock_analysis',
      }
    },
    validateSpec() { return [] },
    ...overrides,
  }
}

test('pack lifecycle registers, enables, disables, and disposes tools', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: ['mock-family'] }), catalog })
  const ctx = createMockContext()
  const registration = forge.registerPack(mockManifest(), ctx)
  assert.equal(forge.listPacks().length, 1)
  assert.equal(forge.listPacks()[0].enabled, false)
  assert.equal(forge.isPackEnabled('mock-family'), true)
  const outcome = registration.enable()
  assert.equal(outcome.blocked, null)
  assert.equal(forge.isPackActive('mock-family'), true)
  assert.equal(ctx.toolsByName.has('revbayes_generate_mock'), true)
  registration.disable()
  assert.equal(ctx.toolsByName.has('revbayes_generate_mock'), false)
  registration.dispose()
  assert.equal(forge.listPacks().length, 0)
})

test('default selector enables verified packs only', () => {
  const forge = createForge({ config: normalizeConfig({}), catalog })
  assert.equal(forge.isPackEnabled('mock-family', 'verified'), true)
  assert.equal(forge.isPackEnabled('mock-family', 'golden'), false)
  assert.equal(forge.isPackEnabled('mock-family', 'experimental'), false)
})

test('none, all, and explicit lists control pack selection', () => {
  const none = createForge({ config: normalizeConfig({ enabledPacks: 'none' }), catalog })
  assert.equal(none.isPackEnabled('mock-family', 'verified'), false)
  const all = createForge({ config: normalizeConfig({ enabledPacks: 'all' }), catalog })
  assert.equal(all.isPackEnabled('mock-family', 'experimental'), true)
  const list = createForge({ config: normalizeConfig({ enabledPacks: ['mock-family'] }), catalog })
  assert.equal(list.isPackEnabled('mock-family', 'experimental'), true)
  assert.equal(list.isPackEnabled('other-pack', 'experimental'), false)
})

test('manifest validation rejects malformed packs', () => {
  assert.throws(() => validatePackManifest(mockManifest({ id: 'Bad Id' })), /kebab-case/)
  assert.throws(() => validatePackManifest(mockManifest({ coreApi: 2 })), /coreApi/)
  assert.throws(() => validatePackManifest(mockManifest({ tools: [{ name: 'run_code' }] })), /run_code/)
  assert.throws(() => validatePackManifest(mockManifest({ analyses: [] })), /analyses/)
  assert.throws(() => validatePackManifest(mockManifest({ dependencies: [{ pack: 'mock-family' }] })), /may not depend on itself/)
})

test('duplicate pack ids, analysis ids, and tool names are rejected', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: 'all' }), catalog })
  forge.registerPack(mockManifest(), createMockContext())
  assert.throws(() => forge.registerPack(mockManifest(), createMockContext()), /duplicate pack/)
  assert.throws(() => forge.registerPack(mockManifest({
    id: 'other-pack',
    analyses: [{ id: 'mock_analysis' }],
    tools: [{ name: 'revbayes_generate_other' }],
  }), createMockContext()), /reuses analysis/)
  assert.throws(() => forge.registerPack(mockManifest({
    id: 'third-pack',
    analyses: [{ id: 'third_analysis' }],
    tools: [{ name: 'revbayes_generate_mock' }],
  }), createMockContext()), /reuses tool/)
})

test('dependency and analysis requirements block enabling cleanly', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: 'all' }), catalog })
  const dependent = mockManifest({
    id: 'dependent-pack',
    analyses: [{ id: 'dependent_analysis', requires: ['mock-family'] }],
    tools: [{ name: 'revbayes_generate_dependent' }],
    dependencies: [{ pack: 'mock-family', minVersion: '0.1.0' }],
  })
  const ctx = createMockContext()
  const registration = forge.registerPack(dependent, ctx)
  const blocked = registration.enable()
  assert.match(blocked.blocked, /missing dependency pack mock-family/)
  assert.equal(ctx.toolsByName.has('revbayes_generate_dependent'), false)

  const family = mockManifest()
  forge.registerPack(family, createMockContext()).enable()
  registration.enable()
  assert.equal(forge.listPacks().find((pack) => pack.id === 'dependent-pack').blockedAnalyses.dependent_analysis, undefined)
})

test('analysis-level requires marks only that analysis blocked', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: 'all' }), catalog })
  const ctx = createMockContext()
  const pack = mockManifest({
    id: 'analysis-deps',
    analyses: [
      { id: 'plain_analysis' },
      { id: 'needs-mock', requires: ['mock-family'] },
    ],
    tools: [{ name: 'revbayes_generate_analysis_deps' }],
  })
  forge.registerPack(pack, ctx).enable()
  const view = forge.listPacks()[0]
  assert.equal(view.enabled, true)
  assert.equal(view.analyses.find((analysis) => analysis.id === 'plain_analysis').blocked, null)
  assert.match(view.analyses.find((analysis) => analysis.id === 'needs-mock').blocked, /mock-family/)

  const familyCtx = createMockContext()
  forge.registerPack(mockManifest(), familyCtx).enable()
  const unblocked = forge.listPacks().find((item) => item.id === 'analysis-deps')
  assert.equal(unblocked.analyses.find((analysis) => analysis.id === 'needs-mock').blocked, null)
  const generated = forge.generateByPack('analysis-deps', 'needs-mock', {}, ctx)
  assert.equal(generated.ok, true)
})

test('dependency cycles are rejected', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: 'all' }), catalog })
  forge.registerPack(mockManifest({
    id: 'a-pack',
    analyses: [{ id: 'a_analysis' }],
    tools: [{ name: 'revbayes_generate_a' }],
    dependencies: [{ pack: 'b-pack' }],
  }), createMockContext())
  assert.throws(() => forge.registerPack(mockManifest({
    id: 'b-pack',
    analyses: [{ id: 'b_analysis' }],
    tools: [{ name: 'revbayes_generate_b' }],
    dependencies: [{ pack: 'a-pack' }],
  }), createMockContext()), /cycle/)
})

test('generateByPack validates and respects enablement', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: ['mock-family'] }), catalog })
  const ctx = createMockContext()
  const registration = forge.registerPack(mockManifest(), ctx)
  const disabled = forge.generateByPack('mock-family', 'mock_analysis', {}, ctx)
  assert.equal(disabled.ok, false)
  assert.equal(disabled.diagnostics[0].code, 'RB4003')
  registration.enable()
  const result = forge.generateByPack('mock-family', 'mock_analysis', {}, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length, 0)
  assert.match(result.script, /mymcmc\.run/)
  const missing = forge.generateByPack('mock-family', 'nope', {}, ctx)
  assert.equal(missing.ok, false)
  assert.equal(missing.diagnostics[0].code, 'RB4004')
})

test('blocks register once and recipes check active packs', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: ['mock-family'] }), catalog })
  const dispose = forge.registerBlock({ id: 'mock.block', build: () => ({ section: { title: 'Mock' }, lines: ['x <- 1'] }) })
  assert.ok(forge.getBlock('mock.block'))
  assert.throws(() => forge.registerBlock({ id: 'mock.block' }), /duplicate block/)
  const recipe = forge.assembly.recipe('mock')
  recipe.requirePack('mock-family').requireBlock('mock.block')
  assert.equal(recipe.check().ok, false)
  forge.registerPack(mockManifest(), createMockContext()).enable()
  assert.equal(recipe.check().ok, true)
  dispose()
  assert.equal(forge.getBlock('mock.block'), null)
})

test('coverage report includes 18 families and installed packs', () => {
  const forge = createForge({ config: normalizeConfig({}), catalog })
  forge.registerPack(mockManifest(), createMockContext())
  const coverage = forge.reportCoverage()
  assert.equal(coverage.families.length, 18)
  assert.equal(coverage.meta.tutorialScripts, 304)
  assert.equal(coverage.packs.length, 1)
  assert.ok(Array.isArray(coverage.unprotectedFamilies))
})

test('reconfigure disables old tools, enables dependencies first, and cleans disposers', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: 'none' }), catalog })
  const ctx = createMockContext()
  forge.registerPack(mockManifest({ id: 'base-pack', tools: [{ name: 'revbayes_generate_base' }] }), ctx)
  forge.registerPack(mockManifest({
    id: 'top-pack',
    analyses: [{ id: 'top_analysis' }],
    tools: [{ name: 'revbayes_generate_top' }],
    dependencies: [{ pack: 'base-pack', minVersion: '0.1.0' }],
  }), ctx)
  let result = forge.reconfigure({ enabledPacks: ['top-pack', 'base-pack'] })
  assert.deepEqual(result.enabledPacks.sort(), ['base-pack', 'top-pack'])
  assert.equal(ctx.toolsByName.has('revbayes_generate_base'), true)
  assert.equal(ctx.toolsByName.has('revbayes_generate_top'), true)
  assert.deepEqual(forge.activeToolNames().sort(), ['revbayes_generate_base', 'revbayes_generate_top'])

  result = forge.reconfigure({ enabledPacks: ['base-pack'] })
  assert.deepEqual(result.enabledPacks, ['base-pack'])
  assert.equal(ctx.toolsByName.has('revbayes_generate_top'), false)
  assert.equal(ctx.toolsByName.has('revbayes_generate_base'), true)
  assert.deepEqual(forge.activeToolNames(), ['revbayes_generate_base'])

  result = forge.reconfigure({ enabledPacks: [] })
  assert.deepEqual(result.activeTools, [])
  assert.equal(ctx.toolsByName.has('revbayes_generate_base'), false)
})

test('reconfigure keeps a pack with unsatisfied dependencies blocked', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: 'none' }), catalog })
  const ctx = createMockContext()
  forge.registerPack(mockManifest({ id: 'base-pack', tools: [{ name: 'revbayes_generate_base' }] }), ctx)
  forge.registerPack(mockManifest({
    id: 'top-pack',
    analyses: [{ id: 'top_analysis' }],
    tools: [{ name: 'revbayes_generate_top' }],
    dependencies: [{ pack: 'base-pack', minVersion: '0.1.0' }],
  }), ctx)
  const result = forge.reconfigure({ enabledPacks: ['top-pack'] })
  assert.equal(result.enabledPacks.length, 0)
  assert.equal(result.blocked.length, 1)
  assert.equal(result.blocked[0].id, 'top-pack')
  assert.match(result.blocked[0].reason, /dependency base-pack/)
  assert.equal(ctx.toolsByName.has('revbayes_generate_top'), false)
  const view = forge.listPacks().find((pack) => pack.id === 'top-pack')
  assert.match(view.blocked, /dependency base-pack/)
  assert.equal(view.dependencies[0].satisfied, false)
})

test('reconfigure persists selection atomically and rejects unknown packs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'revbayes-forge-reconfigure-'))
  try {
    const file = join(dir, 'state.json')
    const stateStore = createStateStore({ file })
    const forge = createForge({ config: normalizeConfig({ enabledPacks: 'none' }), catalog, stateStore })
    const ctx = createMockContext()
    forge.registerPack(mockManifest(), ctx)
    const result = forge.reconfigure({ enabledPacks: ['mock-family'], packConfig: { 'mock-family': { strict: true } } }, { persist: true })
    assert.equal(result.persisted, true)
    assert.equal(result.stateFile, file)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(saved.enabledPacks, ['mock-family'])
    assert.deepEqual(saved.packConfig['mock-family'], { strict: true })
    assert.throws(() => forge.reconfigure({ enabledPacks: ['not-installed'] }), (error) => error.code === 'RB4102')
    assert.throws(() => forge.reconfigure({ enabledPacks: ['mock-family'], packConfig: { 'mock-family': 'bad' } }), (error) => error.code === 'RB4103')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
