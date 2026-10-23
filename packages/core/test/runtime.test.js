import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findRevBayes, prepareRuntimeScript, runRevBayes, checkEnvironment } from '../src/rev/runtime.js'
import { diagnoseRuntime } from '../src/rev/diagnostics.js'
import { loadCatalog } from '../src/rev/catalog.js'
import { generateScript } from '../src/rev/generator.js'

const here = dirname(fileURLToPath(import.meta.url))
const fake = join(here, 'fixtures', 'fake-rb.mjs')
const catalog = loadCatalog()
const script = generateScript({
  analysis: 'dna',
  data: { file: 'data.nex' },
  substitution: { model: 'JC' },
  tree: { source: 'uniform' },
  mcmc: { generations: 10000 },
  name: 'runtime_test',
}, { catalog }).script

test('binary discovery reports version and source', () => {
  const found = findRevBayes({ binary: fake })
  assert.equal(found.found, true)
  assert.equal(found.version, '1.3.0-test')
  assert.equal(found.source, 'config.revbayesBinary')
  assert.equal(findRevBayes({ binary: join(here, 'fixtures', 'does-not-exist') }).found, false)
})

test('dry preparation comments out the run and everything after it', () => {
  const prepared = prepareRuntimeScript(script, { mode: 'dry' })
  assert.equal(prepared.mode, 'dry')
  assert.ok(prepared.runLine > 0)
  assert.match(prepared.script, /^# mymcmc\.run\(/m)
  assert.doesNotMatch(prepared.script.split('\n').filter((l) => !l.startsWith('#')).join('\n'), /\.run\(/)
})

test('smoke preparation caps generations and redirects monitor outputs', () => {
  const prepared = prepareRuntimeScript(script, { mode: 'smoke', maxRunGenerations: 25, tempDir: '/tmp/forge-temp' })
  assert.equal(prepared.mode, 'smoke')
  assert.match(prepared.script, /mymcmc\.run\(generations=25/)
  assert.match(prepared.script, /filename="\/tmp\/forge-temp\/output_1_runtime_test\.log"/)
  assert.doesNotMatch(prepared.script.split('\n').filter((l) => !l.startsWith('#')).join('\n'), /operatorSummary/)
})

test('dry run passes with a working RevBayes stand-in', async () => {
  const result = await runRevBayes({
    binary: fake, script, baseDir: here, mode: 'dry', timeoutMs: 5000,
    maxRunGenerations: 25, catalog, keepTemp: false,
  })
  assert.equal(result.ok, true)
  assert.equal(result.attempted, true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.tempDir, null)
  assert.match(result.stdoutExcerpt, /active run statements = 0/)
})

test('smoke run passes and caps the active run', async () => {
  const result = await runRevBayes({
    binary: fake, script, baseDir: here, mode: 'smoke', timeoutMs: 5000,
    maxRunGenerations: 25, catalog, keepTemp: true,
  })
  assert.equal(result.ok, true)
  assert.match(result.stdoutExcerpt, /generations=25/)
  assert.ok(result.tempDir !== null)
  assert.ok(result.artifacts.includes('analysis.Rev'))
})

test('runtime failures become structured diagnostics with suggestions', async () => {
  const bad = script.replace('mymcmc.run(', 'FORGE_FAKE_FAILURE\nmymcmc.run(')
  const result = await runRevBayes({
    binary: fake, script: bad, baseDir: here, mode: 'dry', timeoutMs: 5000,
    maxRunGenerations: 25, catalog,
  })
  assert.equal(result.ok, false)
  const diagnostic = result.diagnostics.find((d) => d.code === 'RB6001')
  assert.ok(diagnostic)
  assert.match(diagnostic.suggestion, /fnJC/)
  assert.equal(diagnostic.line, bad.split('\n').findIndex((l) => l.includes('dnJC')) === -1 ? diagnostic.line : diagnostic.line)
})

test('timeouts are reported as a runtime failure', async () => {
  const result = await runRevBayes({
    binary: fake, script: 'FORGE_FAKE_SLOW\nq()\n', baseDir: here, mode: 'dry',
    timeoutMs: 1000, catalog,
  })
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.ok(result.diagnostics.some((d) => d.code === 'RB6998'))
})

test('nested run calls are refused instead of executing a full MCMC', async () => {
  const nested = `x ~ dnNormal(0,1)\nif (TRUE) {\n  mymcmc.run(generations=100)\n}\nq()\n`
  const prepared = prepareRuntimeScript(nested, { mode: 'dry' })
  assert.equal(prepared.safe, false)
  const result = await runRevBayes({
    binary: fake, script: nested, baseDir: here, mode: 'dry', timeoutMs: 5000, catalog,
  })
  assert.equal(result.attempted, false)
  assert.equal(result.ok, false)
  assert.equal(result.skippedReason, 'nested run call')
  assert.ok(result.diagnostics.some((d) => d.code === 'RB5905'))
})

test('runtime output parser handles RevBayes overload and missing-variable messages', () => {
  const stderr = `   Error:\tNo overloaded function 'replicate' matches for arguments ( Natural, Integer )
   Potentially matching functions are:
   rep (Integer<any> x, Natural<any> n)
   Missing Variable:\tVariable stopping_rules does not exist
   Error:\tArgument or label mismatch for function call.
   Correct usage is:
   srMinESS (RealPos<any> minEss, String<any> filename)
`
  const result = diagnoseRuntime({
    stdout: '', stderr, exitCode: 1, signal: null, timedOut: false, catalog,
    callLines: new Map([['replicate', 7], ['srMinESS', 9]]),
  })
  assert.equal(result.summary.error, 3)
  assert.equal(result.diagnostics.find((d) => d.code === 'RB6001').line, 7)
  assert.match(result.diagnostics.find((d) => d.code === 'RB6002').suggestion, /srMinESS/)
  assert.match(result.diagnostics.find((d) => d.code === 'RB6003').suggestion, /stopping_rules/)
})

test('runtime parser handles the "No function named" wording and location line', () => {
  const stderr = `   Error:\tNo function named 'dnJC'
   Error:\tProblem processing line 2 in file "/tmp/analysis.Rev"
`
  const result = diagnoseRuntime({
    stdout: '', stderr, exitCode: 1, signal: null, timedOut: false, catalog,
    callLines: new Map([['dnJC', 2]]),
  })
  assert.equal(result.summary.error, 1)
  assert.equal(result.diagnostics[0].code, 'RB6001')
  assert.equal(result.diagnostics[0].line, 2)
  assert.match(result.diagnostics[0].suggestion, /fnJC/)
})

test('environment check reports config and catalog readiness', () => {
  const env = checkEnvironment({ binary: fake, timeoutMs: 1234, maxRunGenerations: 42, allowRuntime: true })
  assert.equal(env.found, true)
  assert.equal(env.version, '1.3.0-test')
  assert.equal(env.timeoutMs, 1234)
  assert.equal(env.maxRunGenerations, 42)
})
