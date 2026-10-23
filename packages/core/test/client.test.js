import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = join(fileURLToPath(import.meta.url), '..')
const clientFile = join(here, '..', 'lib', 'client.js')
const source = readFileSync(clientFile, 'utf8')

function mockReact() {
  return {
    createElement(type, props, ...children) { return { type, props, children } },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
    useEffect() {},
    useMemo(factory) { return factory() },
    useCallback(fn) { return fn },
  }
}

async function loadPlugin() {
  let loaded = null
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) { loaded = spec },
    },
  }
  try {
    await import(`${pathToFileURL(clientFile).href}?test=${Date.now()}`)
  } finally {
    globalThis.window = previousWindow
  }
  assert.ok(loaded !== null, 'client calls window.__ModuleLoader__.load')
  assert.equal(loaded.id, 'dsh-revbayes-forge')
  return loaded.factory((name) => {
    if (name === 'react') return mockReact()
    throw new Error(`unexpected require: ${name}`)
  })
}

test('client factory registers one settings.section with the required options', async () => {
  const plugin = await loadPlugin()
  assert.equal(plugin.name, 'revbayes-forge')
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(typeof plugin.apply, 'function')
  let injected = null
  let registered = null
  const ctx = {
    effect(callback) { callback() },
    slots: {
      inject(name, callback) { injected = name; callback() },
      register(options, component) {
        registered = { options, component }
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.equal(injected, 'settings.section')
  assert.equal(registered.options.name, 'settings.section')
  assert.equal(registered.options.id, 'revbayes-forge')
  assert.equal(registered.options.order, 20)
  assert.equal(registered.options.locale, 'revbayes-forge')
  assert.equal(registered.options.label(), 'RevBayes Forge')
  assert.equal(typeof registered.component, 'function')
})

test('client entry uses the host routes and DSH-safe styling', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(source, /id: 'dsh-revbayes-forge'/)
  assert.match(source, /\/plugins\/dsh-revbayes-forge/)
  assert.match(source, /ctx\.slots\.inject\('settings\.section'/)
  assert.match(source, /\.rbf-btn\.primary \{ background: #4d6bfe; border-color: #4d6bfe; color: #fff; \}/)
  assert.match(source, /text-align: left;/)
  assert.equal(/0\.2\.0|0\.1\.0|开发版|debug/i.test(source), false)
})

test('client samples cover FBD and the core pack metadata supplied by the host', async () => {
  const plugin = await loadPlugin()
  const fbd = plugin.__test.sampleFor('fbd', 'fbd')
  assert.equal(fbd.analysis, 'fbd')
  assert.equal(fbd.data.type, 'Standard')
  const ted = plugin.__test.sampleFor('ted', 'ted')
  assert.equal(ted.analysis, 'ted')
  assert.ok(ted.base_spec)
})
