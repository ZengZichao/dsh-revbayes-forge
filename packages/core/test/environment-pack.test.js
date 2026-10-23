import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog } from '../src/rev/catalog.js'
import { normalizeConfig } from '../src/config.js'
import { createForge } from '../src/service.js'
import { createEnvironmentTool } from '../src/tools/environment.js'
import { createMockContext } from '../src/testing/index.js'

const catalog = loadCatalog()
const exec = { agent: { session: { header: { cwd: process.cwd() } } }, signal: new AbortController().signal, callId: 'env-test' }

const pack = {
  id: 'env-pack',
  version: '0.1.0',
  coreApi: 1,
  maturity: 'verified',
  title: 'Env',
  analyses: [{ id: 'env_analysis' }],
  tools: [{ name: 'revbayes_generate_env', description: 'Env tool.' }],
  generate() { return { ok: true, script: null, diagnostics: [] } },
}

test('environment reports installed/enabled/blocked packs and active tools', async () => {
  const config = normalizeConfig({ enabledPacks: ['env-pack', 'not-installed'] })
  const forge = createForge({ config, catalog })
  const ctx = createMockContext()
  forge.registerPack(pack, ctx).enable()
  const tool = createEnvironmentTool({ config, catalog, forge })
  const value = await tool.execute({}, exec)
  assert.equal(value.packs.length, 1)
  assert.equal(value.packs[0].id, 'env-pack')
  assert.equal(value.packs[0].enabled, true)
  assert.deepEqual(value.tools, ['revbayes_generate_env'])
  assert.deepEqual(value.configured_missing, ['not-installed'])
  assert.ok(Array.isArray(value.uncovered_families))
  const text = tool.output.render({}, value)[0].text
  assert.match(text, /Installed packs:/)
  assert.match(text, /env-pack/)
  assert.match(text, /Configured but not installed: not-installed/)
})

test('environment shows blocked packs without exposing their tools', async () => {
  const config = normalizeConfig({ enabledPacks: 'all' })
  const forge = createForge({ config, catalog })
  const ctx = createMockContext()
  const dependent = { ...pack, id: 'blocked-pack', tools: [{ name: 'revbayes_generate_blocked' }], dependencies: [{ pack: 'missing-pack' }] }
  forge.registerPack(dependent, ctx).enable()
  const tool = createEnvironmentTool({ config, catalog, forge })
  const value = await tool.execute({}, exec)
  assert.equal(value.packs[0].enabled, false)
  assert.match(value.packs[0].blocked, /missing dependency pack/)
  assert.deepEqual(value.tools, [])
})
