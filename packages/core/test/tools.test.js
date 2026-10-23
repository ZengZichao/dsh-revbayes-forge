import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { apply, createTools } from '../src/index.js'
import { normalizeConfig } from '../src/config.js'
import { loadCatalog } from '../src/rev/catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const fake = join(here, 'fixtures', 'fake-rb.mjs')
const config = normalizeConfig({})
const catalog = loadCatalog()
const tools = Object.fromEntries(createTools({ config, catalog }).map((tool) => [tool.name, defineTool(tool)]))
const workspace = mkdtempSync(join(here, '.tmp-tools-'))
const exec = { agent: { session: { header: { cwd: workspace } } }, signal: new AbortController().signal, callId: 'test' }

test.after(() => { rmSync(workspace, { recursive: true, force: true }) })

const spec = {
  analysis: 'dna',
  name: 'tool_test',
  data: { file: 'data.nex' },
  substitution: { model: 'HKY', kappa: 'estimated', base_frequencies: [0.25, 0.25, 0.25, 0.25], gamma: { categories: 4 } },
  tree: { source: 'uniform', outgroup: ['A', 'B'] },
  mcmc: { generations: 5000, output_dir: 'output' },
}

test('apply() registers the four core tools plus verified pack tools on a DSH-like context', () => {
  const registered = []
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    tools: { register(tool) { registered.push(tool); return () => {} } },
  }
  apply(ctx, { stateFile: join(workspace, 'state.json') })
  assert.deepEqual(registered.map((tool) => tool.name).sort(), [
    'revbayes_environment',
    'revbayes_generate',
    'revbayes_generate_coalescent',
    'revbayes_generate_dating',
    'revbayes_generate_diversification',
    'revbayes_generate_fbd',
    'revbayes_generate_ted',
    'revbayes_generate_traits',
    'revbayes_lookup',
    'revbayes_validate',
  ])
  for (const tool of registered) {
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(tool.parameters.type, 'object')
  }
})

test('generate returns a script without writing when output_path is absent', async () => {
  const result = await tools.revbayes_generate.execute({ spec }, exec)
  assert.equal(result.ok, true)
  assert.equal(result.written, false)
  assert.equal(result.path, null)
  assert.match(result.script, /mymcmc\.run\(generations=5000/)
})

test('generate writes within the workspace and creates the monitor directory', async () => {
  const result = await tools.revbayes_generate.execute({ spec, output_path: 'scripts/analysis.Rev' }, exec)
  assert.equal(result.ok, true)
  assert.equal(result.written, true)
  assert.ok(existsSync(join(workspace, 'scripts', 'analysis.Rev')))
  assert.equal(result.created_output_dir, join(workspace, 'scripts', 'output'))
  const text = readFileSync(join(workspace, 'scripts', 'analysis.Rev'), 'utf8')
  assert.match(text, /filename="output\/tool_test\.log"/)
})

test('generate refuses to overwrite without overwrite=true', async () => {
  const first = await tools.revbayes_generate.execute({ spec, output_path: 'scripts/analysis.Rev' }, exec)
  assert.equal(first.written, false)
  const diagnostic = first.diagnostics.find((d) => d.code === 'RB5801')
  assert.ok(diagnostic)
  const second = await tools.revbayes_generate.execute({ spec, output_path: 'scripts/analysis.Rev', overwrite: true }, exec)
  assert.equal(second.ok, true)
  assert.equal(second.written, true)
})

test('generate refuses to write outside the workspace by default', async () => {
  const result = await tools.revbayes_generate.execute({ spec, output_path: '/tmp/revbayes-forge-should-not-exist.Rev' }, exec)
  assert.equal(result.ok, false)
  assert.equal(result.written, false)
  assert.ok(result.diagnostics.some((d) => d.code === 'RB5800'))
})

test('validate accepts inline text and reports static diagnostics', async () => {
  const result = await tools.revbayes_validate.execute({ script: 'Q <- dnJC(4)\nmymcmc.run(generation=10)\n', mode: 'static' }, exec)
  assert.equal(result.static.summary.warning >= 1, true)
  assert.equal(result.runtime.requested, false)
  assert.ok(result.diagnostics.some((d) => d.code === 'RB2101'))
  assert.ok(result.diagnostics.some((d) => d.code === 'RB3102'))
})

test('validate applies safe fixes and returns the fixed script', async () => {
  const result = await tools.revbayes_validate.execute({
    script: 'Q <- dnJC(4)\nmymcmc.run(generation=10)\n',
    mode: 'static',
    apply_fixes: true,
  }, exec)
  assert.ok(result.fixed_script)
  assert.match(result.fixed_script, /fnJC\(4\)/)
  assert.match(result.fixed_script, /generations=10/)
  assert.equal(result.fixes.applied.length >= 2, true)
})

test('validate runs dry and smoke checks through the RevBayes stand-in', async () => {
  writeFileSync(join(workspace, 'data.nex'), '# dummy\n', 'utf8')
  mkdirSync(join(workspace, 'scripts', 'output'), { recursive: true })
  const dry = await tools.revbayes_validate.execute({ path: 'scripts/analysis.Rev', mode: 'dry', binary: fake }, exec)
  assert.equal(dry.ok, true)
  assert.equal(dry.runtime.attempted, true)
  assert.equal(dry.runtime.mode, 'dry')
  assert.equal(dry.runtime.ok, true)
  const smoke = await tools.revbayes_validate.execute({ path: 'scripts/analysis.Rev', mode: 'smoke', binary: fake, max_generations: 20 }, exec)
  assert.equal(smoke.ok, true)
  assert.equal(smoke.runtime.mode, 'smoke')
  assert.match(smoke.runtime.stdout_excerpt, /generations=20/)
})

test('validate skips runtime when static errors are present', async () => {
  const result = await tools.revbayes_validate.execute({
    script: 'x <- \n', mode: 'dry', binary: fake,
  }, exec)
  assert.equal(result.runtime.attempted, false)
  assert.match(result.runtime.skipped_reason, /static/)
})

test('lookup finds a method and its owner signature', async () => {
  const result = await tools.revbayes_lookup.execute({ query: 'mcmc.run' }, exec)
  assert.equal(result.count, 1)
  assert.equal(result.results[0].name, 'mcmc')
  assert.ok(result.results[0].usages.some((u) => u.startsWith('mcmc.run(')))
})

test('lookup searches documentation text', async () => {
  const result = await tools.revbayes_lookup.execute({ query: 'tree prior', limit: 5 }, exec)
  assert.ok(result.count > 0)
})

test('environment reports a ready runtime with an explicit binary', async () => {
  const result = await tools.revbayes_environment.execute({ binary: fake }, exec)
  assert.equal(result.ready_for_runtime, true)
  assert.equal(result.revbayes.version, '1.3.0-test')
  assert.equal(result.catalog.entries, 611)
})
