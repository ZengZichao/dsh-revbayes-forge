import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateStore, defaultStateFile, dshHome, normalizeState, STATE_VERSION } from '../src/state.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'revbayes-forge-state-'))
}

test('state is written atomically and read back', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'nested', 'state.json')
    const store = createStateStore({ file })
    assert.equal(store.read(), null)
    store.write({ enabledPacks: ['fbd', 'dating'], packConfig: { fbd: { strictTaxonomy: true } } })
    assert.equal(existsSync(file), true)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(raw.version, STATE_VERSION)
    assert.deepEqual(raw.enabledPacks, ['fbd', 'dating'])
    assert.equal(typeof raw.updatedAt, 'string')
    const loaded = store.read()
    assert.deepEqual(loaded.enabledPacks, ['fbd', 'dating'])
    assert.deepEqual(loaded.packConfig.fbd, { strictTaxonomy: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupt or invalid state files are ignored, not fatal', () => {
  const dir = tempDir()
  try {
    const file = join(dir, 'state.json')
    writeFileSync(file, '{not json', 'utf8')
    const store = createStateStore({ file })
    assert.equal(store.read(), null)
    writeFileSync(file, JSON.stringify({ enabledPacks: 'all' }), 'utf8')
    assert.equal(store.read(), null)
    assert.equal(normalizeState({ enabledPacks: ['Bad Id'] }), null)
    assert.equal(normalizeState(null), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('state normalizes ids and drops invalid packConfig entries', () => {
  const normalized = normalizeState({
    enabledPacks: ['fbd', 'fbd', 'dating'],
    packConfig: { fbd: { a: 1 }, 'Bad Id': { b: 2 }, dating: null },
  })
  assert.deepEqual(normalized.enabledPacks, ['fbd', 'dating'])
  assert.deepEqual(normalized.packConfig, { fbd: { a: 1 } })
})

test('default state path lives under DSH_HOME', () => {
  assert.equal(dshHome({ DSH_HOME: 'C:/tmp/forge-home' }), 'C:\\tmp\\forge-home')
  assert.equal(defaultStateFile({ DSH_HOME: 'C:/tmp/forge-home' }), 'C:\\tmp\\forge-home\\revbayes-forge\\state.json')
  assert.match(defaultStateFile({}), /\.dsh[\\/]revbayes-forge[\\/]state\.json$/)
})
