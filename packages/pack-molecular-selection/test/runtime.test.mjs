import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog, runRevBayes } from 'dsh-revbayes-forge'
import manifest from '../src/manifest.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(here, '..', 'fixtures')
const binary = process.env.REVBAYES_BIN ?? ''
const runtimeRequired = manifest.maturity === 'verified' || process.env.REVBAYES_RUNTIME_ALL === '1'
const goldenDir = join(fixtureDir, 'golden')

test('real RevBayes dry/smoke fixture', { skip: binary.length === 0 ? 'REVBAYES_BIN is not set' : (runtimeRequired ? false : 'pack maturity is ' + manifest.maturity + '; set REVBAYES_RUNTIME_ALL=1 to run optional runtime coverage') }, async () => {
  const entry = readdirSync(goldenDir).find((name) => name.endsWith('.Rev'))
  assert.ok(entry, 'a canonical golden script is missing')
  const script = readFileSync(join(goldenDir, entry), 'utf8')
  const catalog = loadCatalog()
  const dry = await runRevBayes({
    binary,
    script,
    baseDir: fixtureDir,
    mode: 'dry',
    timeoutMs: 120000,
    maxRunGenerations: manifest.runtime.recommendedSmokeGenerations,
    catalog,
  })
  assert.equal(dry.ok, true, `dry run failed: ${dry.stdoutExcerpt ?? ''}\n${JSON.stringify(dry.diagnostics)}`)
  const smoke = await runRevBayes({
    binary,
    script,
    baseDir: fixtureDir,
    mode: 'smoke',
    timeoutMs: 120000,
    maxRunGenerations: manifest.runtime.recommendedSmokeGenerations,
    catalog,
  })
  assert.equal(smoke.ok, true, `smoke run failed: ${smoke.stdoutExcerpt ?? ''}\n${JSON.stringify(smoke.diagnostics)}`)
})

test('runtime fixtures exist on disk', () => {
  assert.ok(existsSync(join(fixtureDir, 'data')))
  assert.ok(Array.isArray(manifest.runtime.fixtures) && manifest.runtime.fixtures.length > 0)
})
