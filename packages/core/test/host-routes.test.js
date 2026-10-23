import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { loadCatalog } from '../src/rev/catalog.js'
import { normalizeConfig } from '../src/config.js'
import { createForge } from '../src/service.js'
import { createStateStore } from '../src/state.js'
import { BUILTIN_PACKS } from '../src/packs/builtin/index.js'
import { mountForgeRoutes, ROUTES } from '../src/host/routes.js'
import { createMockContext } from '../src/testing/index.js'

const catalog = loadCatalog()
const here = join(fileURLToPath(import.meta.url), '..')
const fakeRb = join(here, 'fixtures', 'fake-rb.mjs')

const FBD_SPEC = {
  analysis: 'fbd',
  name: 'fbd_ui_demo',
  data: {
    file: 'data/bears_morphology.nex',
    taxa_file: 'data/bears_taxa.tsv',
    matrix_file: 'data/bears_morphology.nex',
    type: 'Standard',
    state_count: 2,
  },
  fbd: { lambda: 1, mu: 0.2, psi: 0.1, rho: 1, origin: 45 },
  mcmc: { generations: 500, sample_every: 10 },
}

function fakeRes() {
  return {
    statusCode: 0,
    payload: '',
    writableEnded: false,
    writeHead(status) { this.statusCode = status },
    end(payload) {
      this.payload = payload
      this.writableEnded = true
    },
  }
}

function fakeReq(method, body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from(text === '' ? [] : [text])
  req.method = method
  req.headers = {}
  return req
}

function setup() {
  const workspace = mkdtempSync(join(tmpdir(), 'revbayes-forge-ui-'))
  const stateFile = join(workspace, '.state', 'state.json')
  const config = normalizeConfig({
    enabledPacks: 'default',
    workspace,
    stateFile,
    revbayesBinary: fakeRb,
    allowRuntime: true,
    timeoutMs: 5000,
  })
  const stateStore = createStateStore({ file: stateFile })
  const forge = createForge({ config, catalog, stateStore })
  const ctx = createMockContext()
  for (const pack of BUILTIN_PACKS) forge.registerPack(pack, ctx)
  forge.reconfigure({ enabledPacks: config.enabledPacks, packConfig: {} }, { persist: false })
  const handlers = new Map()
  ctx.get = (name) => name === 'webServer'
    ? {
        register(route) {
          handlers.set(route.path, route.handler)
          return () => handlers.delete(route.path)
        },
      }
    : undefined
  mountForgeRoutes(ctx, { forge, config, catalog, stateStore, logger: ctx.logger })
  const call = async (path, method = 'GET', body = undefined) => {
    const handler = handlers.get(path)
    assert.ok(handler, `route ${path} is registered`)
    const res = fakeRes()
    await handler(fakeReq(method, body), res)
    return { status: res.statusCode, body: JSON.parse(res.payload) }
  }
  return { workspace, stateFile, config, stateStore, forge, ctx, handlers, call }
}

function cleanup(workspace) {
  rmSync(workspace, { recursive: true, force: true })
}

test('state route reports core, 13 packs, dependencies, catalog and active tools', async () => {
  const env = setup()
  try {
    const { status, body } = await env.call(ROUTES.state)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.counts.packs, 13)
    assert.equal(body.counts.core_tools, 4)
    assert.equal(body.counts.enabled_packs, 6)
    assert.equal(body.packs.length, 13)
    assert.equal(body.tools.core.length, 4)
    assert.ok(body.tools.all.includes('revbayes_generate_fbd'))
    const ted = body.packs.find((pack) => pack.id === 'ted')
    assert.deepEqual(ted.dependencies.map((dependency) => dependency.pack), ['fbd', 'dating'])
    assert.equal(ted.dependencies.every((dependency) => dependency.satisfied), true)
    const dating = body.packs.find((pack) => pack.id === 'dating')
    assert.equal(dating.analyses.find((analysis) => analysis.id === 'timefig_dating').blocked, 'requires pack biogeo')
    assert.equal(body.revbayes.found, true)
    assert.equal(body.revbayes.version, '1.3.0-test')
    assert.equal(body.catalog.entries > 100, true)
    assert.equal(body.state.file, env.stateFile)
    assert.equal(JSON.stringify(body).includes('undefined'), false)
  } finally {
    cleanup(env.workspace)
  }
})

test('packs route hot-swaps tools, blocks TED without dating, and persists state', async () => {
  const env = setup()
  try {
    let response = await env.call(ROUTES.packs, 'POST', { enabledPacks: ['fbd', 'dating', 'ted'] })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.applied.blocked, [])
    assert.ok(response.body.tools.all.includes('revbayes_generate_ted'))
    assert.equal(env.ctx.toolsByName.has('revbayes_generate_ted'), true)

    response = await env.call(ROUTES.packs, 'POST', { enabledPacks: ['fbd', 'ted'] })
    assert.equal(response.status, 200)
    assert.equal(response.body.applied.blocked.length, 1)
    assert.equal(response.body.applied.blocked[0].id, 'ted')
    assert.match(response.body.applied.blocked[0].reason, /dating/)
    assert.equal(env.ctx.toolsByName.has('revbayes_generate_ted'), false)
    assert.equal(env.ctx.toolsByName.has('revbayes_generate_fbd'), true)
    assert.equal(response.body.tools.all.includes('revbayes_generate_ted'), false)
    const ted = response.body.packs.find((pack) => pack.id === 'ted')
    assert.match(ted.blocked, /dating/)

    const saved = JSON.parse(readFileSync(env.stateFile, 'utf8'))
    assert.deepEqual(saved.enabledPacks, ['fbd', 'ted'])
    const reloaded = createStateStore({ file: env.stateFile }).read()
    assert.deepEqual(reloaded.enabledPacks, ['fbd', 'ted'])
  } finally {
    cleanup(env.workspace)
  }
})

test('packs route rejects unknown ids with a structured error', async () => {
  const env = setup()
  try {
    const response = await env.call(ROUTES.packs, 'POST', { enabledPacks: ['not-a-pack'] })
    assert.equal(response.status, 400)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.error.code, 'RB4102')
    assert.equal(response.body.error.path, 'enabledPacks')
  } finally {
    cleanup(env.workspace)
  }
})

test('generate route produces an FBD script and can write it inside the workspace', async () => {
  const env = setup()
  try {
    let response = await env.call(ROUTES.generate, 'POST', { pack: 'fbd', analysis: 'fbd', spec: FBD_SPEC })
    assert.equal(response.status, 200)
    assert.equal(response.body.ok, true)
    assert.equal(response.body.result.artifacts.length, 1)
    assert.match(response.body.result.primary_script, /fbd|speciation_rate/)
    assert.equal(response.body.result.written, false)

    response = await env.call(ROUTES.generate, 'POST', {
      pack: 'fbd',
      analysis: 'fbd',
      spec: FBD_SPEC,
      outputPath: 'scripts/from_ui.Rev',
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.result.written, true)
    assert.equal(existsSync(join(env.workspace, 'scripts', 'from_ui.Rev')), true)
  } finally {
    cleanup(env.workspace)
  }
})

test('generate route refuses disabled packs and malformed specs', async () => {
  const env = setup()
  try {
    await env.call(ROUTES.packs, 'POST', { enabledPacks: ['dating'] })
    let response = await env.call(ROUTES.generate, 'POST', { pack: 'fbd', analysis: 'fbd', spec: FBD_SPEC })
    assert.equal(response.status, 409)
    assert.equal(response.body.error.code, 'RB4114')

    await env.call(ROUTES.packs, 'POST', { enabledPacks: ['fbd'] })
    response = await env.call(ROUTES.generate, 'POST', { pack: 'fbd', analysis: 'fbd', spec: { analysis: 'fbd' } })
    assert.equal(response.status, 200)
    assert.equal(response.body.ok, false)
    assert.equal(response.body.result.ok, false)
    assert.ok(response.body.result.diagnostics.some((diagnostic) => String(diagnostic.code).startsWith('FBD')))
  } finally {
    cleanup(env.workspace)
  }
})

test('validate route runs static and dry modes', async () => {
  const env = setup()
  try {
    const generated = await env.call(ROUTES.generate, 'POST', {
      pack: 'fbd',
      analysis: 'fbd',
      spec: FBD_SPEC,
      outputPath: 'scripts/dry.Rev',
    })
    assert.equal(generated.body.result.written, true)

    let response = await env.call(ROUTES.validate, 'POST', { path: 'scripts/dry.Rev', mode: 'static' })
    assert.equal(response.status, 200)
    assert.equal(response.body.result.runtime.requested, false)
    assert.equal(response.body.result.static.summary.error, 0)

    response = await env.call(ROUTES.validate, 'POST', { path: 'scripts/dry.Rev', mode: 'dry' })
    assert.equal(response.status, 200)
    assert.equal(response.body.result.runtime.attempted, true)
    assert.equal(response.body.result.runtime.ok, true)
    assert.equal(response.body.result.runtime.binary_version, '1.3.0-test')
  } finally {
    cleanup(env.workspace)
  }
})

test('validate route rejects ambiguous input and method mismatches', async () => {
  const env = setup()
  try {
    let response = await env.call(ROUTES.validate, 'POST', { script: 'q()', path: 'x.Rev', mode: 'static' })
    assert.equal(response.status, 400)
    assert.equal(response.body.error.code, 'RB4120')
    response = await env.call(ROUTES.state, 'POST', {})
    assert.equal(response.status, 405)
  } finally {
    cleanup(env.workspace)
  }
})

test('tool-schema route lists core and active pack tools', async () => {
  const env = setup()
  try {
    const response = await env.call(ROUTES.toolSchema)
    assert.equal(response.status, 200)
    assert.equal(response.body.core.length, 4)
    assert.ok(response.body.packs.some((tool) => tool.name === 'revbayes_generate_fbd'))
    assert.ok(response.body.packs.every((tool) => typeof tool.parameters === 'object'))
  } finally {
    cleanup(env.workspace)
  }
})
