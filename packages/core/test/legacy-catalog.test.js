import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog, lookupEntry, isKnownCallable, signaturesFor, methodsFor } from '../src/rev/catalog.js'
import { LEGACY_FUNCTIONS, LEGACY_METHOD_NAMES } from '../src/data/legacy-catalog.js'

const catalog = loadCatalog()

test('legacy functions are callable, lookup-able, and marked legacy', () => {
  assert.equal(LEGACY_FUNCTIONS.length, 18)
  for (const entry of LEGACY_FUNCTIONS) {
    assert.equal(isKnownCallable(catalog, entry.name), true, entry.name)
    const resolved = lookupEntry(catalog, entry.name)
    assert.ok(resolved !== null, entry.name)
    assert.equal(resolved.legacy, true)
    assert.ok(signaturesFor(catalog, entry.name).length > 0, entry.name)
  }
})

test('legacy/generic object methods resolve through obj.method lookups', () => {
  assert.equal(LEGACY_METHOD_NAMES.length, 27)
  for (const name of LEGACY_METHOD_NAMES) {
    const resolved = lookupEntry(catalog, name)
    assert.ok(resolved !== null, name)
    assert.ok(resolved.methods.length > 0, name)
    assert.ok(methodsFor(catalog, name).length > 0, name)
  }
  assert.equal(lookupEntry(catalog, 'append').canonicalName, 'append')
  assert.ok(lookupEntry(catalog, 'clamp').methods[0].usage.startsWith('clamp('))
})

test('supplemental legacy entries do not change the upstream help counts', () => {
  assert.equal(catalog.meta.entries, 611)
  assert.equal(catalog.meta.signatures, 654)
  assert.equal(catalog.meta.methods, 451)
  assert.equal(catalog.meta.legacyFunctions, 18)
  assert.equal(catalog.meta.legacyMethods, 27)
  assert.ok(catalog.meta.totalEntries > catalog.meta.entries)
})

test('legacy overloads cover tutorial FBD and taxon-reading argument names', () => {
  const fbd = signaturesFor(catalog, 'dnFBDP')
  assert.ok(fbd.some((signature) => signature.usage.includes('origin')))
  const taxa = signaturesFor(catalog, 'readTaxonData')
  assert.ok(taxa.some((signature) => signature.usage.includes('file')))
})
