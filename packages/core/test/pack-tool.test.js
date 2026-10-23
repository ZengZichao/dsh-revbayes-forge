import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from '../src/rev/catalog.js'
import { normalizeConfig } from '../src/config.js'
import { createForge } from '../src/service.js'
import { createMockContext } from '../src/testing/index.js'

const catalog = loadCatalog()
const validScript = 'moves = VectorMoves()\nmonitors = VectorMonitors()\nQ <- fnJC(4)\nmymodel = model(Q)\nmymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)\nmymcmc.run(generations=10)\nq()\n'

function pack(overrides = {}) {
  return {
    id: 'writes-pack',
    version: '0.1.0',
    coreApi: 1,
    maturity: 'verified',
    title: 'Writes',
    analyses: [{ id: 'one' }, { id: 'many' }, { id: 'dependent', requires: ['other-pack'] }],
    tools: [{ name: 'revbayes_generate_writes', description: 'Write artifacts.' }],
    dependencies: [],
    generate(spec) {
      if (spec.analysis === 'many') {
        return {
          ok: true,
          script: validScript,
          primary_script: validScript,
          artifacts: [
            { role: 'main', name: 'main.Rev', script: validScript },
            { role: 'simulation', name: 'sim.Rev', script: validScript },
          ],
          diagnostics: [],
          sections: [],
          stats: { lines: 8, bytes: 200, moves: 1, monitors: 0 },
        }
      }
      return { ok: true, script: validScript, diagnostics: [], sections: [], stats: { lines: 8, bytes: 200, moves: 1, monitors: 0 }, name: 'single' }
    },
    ...overrides,
  }
}

function setup(workspace, config = { enabledPacks: ['writes-pack'] }) {
  const forge = createForge({ config: normalizeConfig(config), catalog })
  const ctx = createMockContext()
  forge.registerPack(pack(), ctx).enable()
  return { forge, tool: ctx.toolsByName.get('revbayes_generate_writes') }
}

const exec = (workspace) => ({ agent: { session: { header: { cwd: workspace } } }, signal: new AbortController().signal, callId: 'pack-tool-test' })

test('pack tool writes a single script to a file path', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const workspace = mkdtempSync(join(tmpdir(), 'forge-pack-tool-'))
  try {
    const { tool } = setup(workspace)
    const result = await tool.execute({ spec: { analysis: 'one' }, output_path: 'scripts/analysis.Rev' }, exec(workspace))
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
    assert.equal(result.written, true)
    assert.deepEqual(result.paths, [join(workspace, 'scripts', 'analysis.Rev')])
    assert.equal(existsSync(join(workspace, 'scripts', 'analysis.Rev')), true)
    assert.match(readFileSync(join(workspace, 'scripts', 'analysis.Rev'), 'utf8'), /fnJC/)
    assert.equal(result.primary_script, validScript)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('workflow pack writes multiple artifacts into an output directory', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const workspace = mkdtempSync(join(tmpdir(), 'forge-pack-tool-'))
  try {
    const { tool } = setup(workspace)
    const result = await tool.execute({ spec: { analysis: 'many' }, output_path: 'out' }, exec(workspace))
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
    assert.equal(result.artifacts.length, 2)
    assert.equal(existsSync(join(workspace, 'out', 'main.Rev')), true)
    assert.equal(existsSync(join(workspace, 'out', 'sim.Rev')), true)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('pack tool refuses overwrite and outside-workspace paths', async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const workspace = mkdtempSync(join(tmpdir(), 'forge-pack-tool-'))
  try {
    const { tool } = setup(workspace)
    mkdirSync(join(workspace, 'scripts'), { recursive: true })
    writeFileSync(join(workspace, 'scripts', 'analysis.Rev'), 'old', 'utf8')
    const refused = await tool.execute({ spec: { analysis: 'one' }, output_path: 'scripts/analysis.Rev' }, exec(workspace))
    assert.equal(refused.ok, false)
    assert.equal(refused.written, false)
    assert.ok(refused.diagnostics.some((diagnostic) => /overwrite/.test(diagnostic.message)))
    const outside = await tool.execute({ spec: { analysis: 'one' }, output_path: '/tmp/forge-should-not-exist.Rev' }, exec(workspace))
    assert.equal(outside.ok, false)
    assert.ok(outside.diagnostics.some((diagnostic) => /outside the workspace/.test(diagnostic.message)))
    const overwrite = await tool.execute({ spec: { analysis: 'one' }, output_path: 'scripts/analysis.Rev', overwrite: true }, exec(workspace))
    assert.equal(overwrite.ok, true)
    assert.equal(overwrite.written, true)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('disabled packs do not register a tool', () => {
  const forge = createForge({ config: normalizeConfig({ enabledPacks: ['writes-pack'] }), catalog })
  const ctx = createMockContext()
  forge.registerPack(pack(), ctx)
  assert.equal(ctx.toolsByName.has('revbayes_generate_writes'), false)
})

test('tool refuses an analysis whose cross-pack requirements are not active', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const workspace = mkdtempSync(join(tmpdir(), 'forge-pack-tool-'))
  try {
    const { tool } = setup(workspace)
    const result = await tool.execute({ spec: { analysis: 'dependent' } }, exec(workspace))
    assert.equal(result.ok, false)
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'RB4005'))
    assert.equal(result.artifacts.length, 0)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
