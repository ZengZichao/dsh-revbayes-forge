import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog, lookupEntry, nearestName, resolveEntry, searchCatalog, signaturesFor } from '../src/rev/catalog.js'

const catalog = loadCatalog()

test('bundled catalog has the RevBayes help corpus', () => {
  assert.ok(catalog.meta.entries >= 600)
  assert.ok(catalog.meta.signatures >= 600)
  assert.ok(catalog.meta.methods >= 400)
})

test('aliases resolve to canonical entries', () => {
  assert.equal(lookupEntry(catalog, 'treeAssembly').canonicalName, 'fnTreeAssembly')
  assert.equal(lookupEntry(catalog, 'q').canonicalName, 'quit')
  assert.equal(lookupEntry(catalog, 'dnExp').canonicalName, 'dnExponential')
})

test('signatures expose named arguments and enum options', () => {
  const entry = resolveEntry(catalog, 'dnPhyloCTMC')
  const signature = entry.signatures[0]
  const type = signature.params.find((p) => p.name === 'type')
  assert.ok(type.options.includes('DNA'))
  assert.ok(type.options.includes('Standard'))
  const mcmc = signaturesFor(catalog, 'mcmc')[0]
  assert.deepEqual(mcmc.params.slice(0, 3).map((p) => p.name), ['model', 'monitors', 'moves'])
  assert.equal(mcmc.params[0].required, true)
})

test('search prefers exact and prefix matches', () => {
  const results = searchCatalog(catalog, 'GTR', { limit: 5 })
  assert.equal(results[0].name, 'fnGTR')
})

test('nearestName suggests a close spelling', () => {
  assert.equal(nearestName('dnJC', [...catalog.callableNames]), 'fnJC')
})
