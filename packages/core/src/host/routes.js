/**
 * Host HTTP surface for the RevBayes Forge settings page.
 *
 * Every route lives under /plugins/dsh-revbayes-forge/ and is an exact
 * registration on the DSH web carrier. The handlers reuse the same forge
 * service, pack tools, static validator, and workspace write guard as the
 * model-facing tools; this module adds no shell execution and no relaxed
 * validation.
 */
import { checkEnvironment } from '../rev/runtime.js'
import { createPackTool } from '../tools/pack.js'
import { createValidateTool } from '../tools/validate.js'
import { createGenerateTool } from '../tools/generate.js'
import { createLookupTool } from '../tools/lookup.js'
import { createEnvironmentTool } from '../tools/environment.js'
import { CORE_TOOL_NAMES } from '../service.js'

export const ROUTE_PREFIX = '/plugins/dsh-revbayes-forge'
export const ROUTES = Object.freeze({
  state: `${ROUTE_PREFIX}/state`,
  packs: `${ROUTE_PREFIX}/packs`,
  generate: `${ROUTE_PREFIX}/generate`,
  validate: `${ROUTE_PREFIX}/validate`,
  toolSchema: `${ROUTE_PREFIX}/tool-schema`,
  detect: `${ROUTE_PREFIX}/detect`,
})

const MAX_BODY_BYTES = 2 * 1024 * 1024

function sendJson(res, status, body) {
  if (res.writableEnded) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendError(res, status, code, message, path = null) {
  sendJson(res, status, { ok: false, error: { code, message, ...(path === null ? {} : { path }) } })
}

function readJsonBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limitBytes) {
        tooLarge = true
        const error = new Error('request body is too large')
        error.status = 413
        error.code = 'RB4130'
        reject(error)
        req.resume()
        return
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => {
      if (tooLarge) return
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        resolve({})
        return
      }
      try {
        const value = JSON.parse(text)
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          const error = new Error('request body must be a JSON object')
          error.status = 400
          error.code = 'RB4131'
          reject(error)
          return
        }
        resolve(value)
      } catch {
        const error = new Error('request body is not valid JSON')
        error.status = 400
        error.code = 'RB4131'
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function uiExec(config) {
  return {
    agent: { session: { header: { cwd: config.workspace } } },
    signal: new AbortController().signal,
    callId: 'revbayes-forge-settings',
  }
}

function compatibleHostBinary(value, workspace) {
  if (typeof value !== 'string' || value.trim().length === 0) return ''
  const trimmed = value.trim()
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') ? trimmed : `${workspace}/${trimmed}`
}

function detectEnvironment(config, overrideBinary = '') {
  return checkEnvironment({
    binary: compatibleHostBinary(overrideBinary, config.workspace) || config.revbayesBinary,
    timeoutMs: config.timeoutMs,
    maxRunGenerations: config.maxRunGenerations,
    tempRoot: config.tempRoot,
    allowRuntime: config.allowRuntime,
  })
}

function catalogInfo(catalog, config) {
  return {
    path: config.catalogPath.length > 0 ? config.catalogPath : '(bundled)',
    entries: catalog.meta?.entries ?? Object.keys(catalog.entries ?? {}).length,
    signatures: catalog.meta?.signatures ?? 0,
    methods: catalog.meta?.methods ?? 0,
  }
}

/** Build the JSON state document consumed by every settings tab. */
export function buildState({ forge, config, catalog, stateStore, probe = false }) {
  const packs = forge.listPacks()
  const coverage = forge.reportCoverage()
  const environment = detectEnvironment(config)
  const packTools = packs.filter((pack) => pack.enabled).flatMap((pack) => pack.tools)
  const coreTools = [...CORE_TOOL_NAMES]
  return {
    ok: true,
    core: {
      name: 'dsh-revbayes-forge',
      api_version: forge.apiVersion,
      status: 'ready',
      active: true,
      restart_required: false,
    },
    revbayes: {
      found: probe ? environment.found : environment.found,
      binary: environment.binary ?? '',
      version: environment.version ?? '',
      source: environment.source ?? '',
      checked: environment.checked ?? [],
    },
    environment: {
      allow_runtime: config.allowRuntime,
      timeout_ms: config.timeoutMs,
      max_run_generations: config.maxRunGenerations,
      workspace: config.workspace,
      temp_root: config.tempRoot,
      catalog_path: config.catalogPath.length > 0 ? config.catalogPath : '(bundled)',
      allow_write_outside_workspace: config.allowWriteOutsideWorkspace,
      default_mode: config.defaultMode,
      default_runtime_mode: config.defaultRuntimeMode,
    },
    catalog: catalogInfo(catalog, config),
    packs,
    counts: {
      packs: packs.length,
      enabled_packs: packs.filter((pack) => pack.enabled).length,
      blocked_packs: packs.filter((pack) => pack.blocked !== null).length,
      core_tools: coreTools.length,
      pack_tools: packTools.length,
      active_tools: coreTools.length + packTools.length,
    },
    tools: {
      core: coreTools,
      packs: packTools,
      all: [...coreTools, ...packTools],
    },
    uncovered_families: coverage.unprotectedFamilies ?? [],
    requested_packs: forge.requestedPackIds(),
    state: {
      file: stateStore?.file ?? '',
      exists: stateStore !== null && stateStore.read() !== null,
      persisted: stateStore !== null,
      applied_immediately: true,
      restart_required: false,
    },
  }
}

function createHandlers(services) {
  const { forge, config, catalog, stateStore, logger } = services

  const stateHandler = async (req, res) => {
    if (req.method !== 'GET') return sendError(res, 405, 'RB4050', 'method not allowed')
    sendJson(res, 200, buildState(services))
  }

  const packsHandler = async (req, res) => {
    if (req.method !== 'POST') return sendError(res, 405, 'RB4050', 'method not allowed')
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return sendError(res, error.status ?? 400, error.code ?? 'RB4131', error.message)
    }
    if (!Array.isArray(body.enabledPacks)) {
      return sendError(res, 400, 'RB4101', 'enabledPacks must be an array of pack ids', 'enabledPacks')
    }
    let result
    try {
      result = forge.reconfigure({ enabledPacks: body.enabledPacks, packConfig: body.packConfig ?? {} }, { persist: true })
    } catch (error) {
      return sendPackError(res, error)
    }
    const state = buildState(services)
    sendJson(res, 200, {
      ...state,
      applied: {
        requested: result.requested,
        enabled: result.enabledPacks,
        blocked: result.blocked,
        active_tools: result.activeTools,
        persisted: result.persisted,
        restart_required: false,
      },
    })
  }

  const generateHandler = async (req, res) => {
    if (req.method !== 'POST') return sendError(res, 405, 'RB4050', 'method not allowed')
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return sendError(res, error.status ?? 400, error.code ?? 'RB4131', error.message)
    }
    const packId = body.pack
    if (typeof packId !== 'string' || packId.length === 0) {
      return sendError(res, 400, 'RB4110', 'pack is required', 'pack')
    }
    const manifest = forge.getPackManifest(packId)
    if (manifest === null) return sendError(res, 404, 'RB4111', `pack "${packId}" is not installed`, 'pack')
    if (forge.isPackActive(packId) !== true) {
      return sendError(res, 409, 'RB4114', `pack "${packId}" is not enabled`, 'pack')
    }
    const analysis = typeof body.analysis === 'string' && body.analysis.length > 0
      ? body.analysis
      : manifest.analyses[0]?.id
    if (manifest.analyses.some((item) => item.id === analysis) === false) {
      return sendError(res, 400, 'RB4112', `pack "${packId}" has no analysis "${analysis}"`, 'analysis')
    }
    const spec = body.spec === undefined ? {} : body.spec
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      return sendError(res, 400, 'RB4113', 'spec must be a JSON object', 'spec')
    }
    const toolSpec = manifest.tools[0]
    const tool = createPackTool({
      pack: manifest,
      toolSpec,
      forge,
      packConfig: { ...(forge.config.packConfig?.[packId] ?? {}) },
    })
    let value
    try {
      value = await tool.execute({
        spec: { ...spec, analysis },
        ...(typeof body.outputPath === 'string' && body.outputPath.length > 0 ? { output_path: body.outputPath } : {}),
        ...(body.overwrite === true ? { overwrite: true } : {}),
      }, uiExec(config))
    } catch (error) {
      return sendPackError(res, error)
    }
    sendJson(res, 200, { ok: value.ok, pack: packId, analysis, result: value })
  }

  const validateHandler = async (req, res) => {
    if (req.method !== 'POST') return sendError(res, 405, 'RB4050', 'method not allowed')
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return sendError(res, error.status ?? 400, error.code ?? 'RB4131', error.message)
    }
    const hasScript = typeof body.script === 'string' && body.script.trim().length > 0
    const hasPath = typeof body.path === 'string' && body.path.trim().length > 0
    if (hasScript === hasPath) {
      return sendError(res, 400, 'RB4120', 'provide exactly one of script or path')
    }
    const mode = body.mode === undefined ? config.defaultMode : body.mode
    if (!['auto', 'static', 'dry', 'smoke'].includes(mode)) {
      return sendError(res, 400, 'RB4121', 'mode must be auto, static, dry, or smoke', 'mode')
    }
    const tool = createValidateTool({ config, catalog, forge })
    let value
    try {
      value = await tool.execute({
        ...(hasScript ? { script: body.script } : { path: body.path }),
        mode,
        ...(body.strict === true ? { strict: true } : {}),
        ...(body.applyFixes === true ? { apply_fixes: true } : {}),
        ...(body.allowRiskyFixes === true ? { allow_risky_fixes: true } : {}),
        ...(body.checkFiles === true ? { check_files: true } : {}),
      }, uiExec(config))
    } catch (error) {
      return sendPackError(res, error)
    }
    sendJson(res, 200, { ok: value.ok, result: value })
  }

  const toolSchemaHandler = async (req, res) => {
    if (req.method !== 'GET') return sendError(res, 405, 'RB4050', 'method not allowed')
    const core = [createGenerateTool(services), createValidateTool(services), createLookupTool(services), createEnvironmentTool(services)]
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
    const packs = forge.listPacks()
      .filter((pack) => pack.enabled)
      .map((pack) => {
        const manifest = forge.getPackManifest(pack.id)
        const tool = manifest.tools[0]
        return {
          pack: pack.id,
          name: tool.name,
          description: tool.description ?? '',
          parameters: typeof tool.parameters === 'function' ? tool.parameters() : (tool.parameters ?? {}),
        }
      })
    sendJson(res, 200, { ok: true, core, packs })
  }

  const detectHandler = async (req, res) => {
    if (req.method !== 'POST') return sendError(res, 405, 'RB4050', 'method not allowed')
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return sendError(res, error.status ?? 400, error.code ?? 'RB4131', error.message)
    }
    const environment = detectEnvironment(config, typeof body.binary === 'string' ? body.binary : '')
    sendJson(res, 200, {
      ok: true,
      revbayes: {
        found: environment.found,
        binary: environment.binary ?? '',
        version: environment.version ?? '',
        source: environment.source ?? '',
        checked: environment.checked ?? [],
      },
    })
  }

  function sendPackError(res, error) {
    logger?.warn?.(`[revbayes-forge] settings request failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    const known = error instanceof Error && (error.name === 'PackSpecError' || typeof error.code === 'string')
    sendError(
      res,
      known ? 400 : 500,
      known && typeof error.code === 'string' ? error.code : 'RB5000',
      known ? error.message : 'internal revbayes-forge error',
      known && typeof error.path === 'string' ? error.path : null,
    )
  }

  return {
    [ROUTES.state]: stateHandler,
    [ROUTES.packs]: packsHandler,
    [ROUTES.generate]: generateHandler,
    [ROUTES.validate]: validateHandler,
    [ROUTES.toolSchema]: toolSchemaHandler,
    [ROUTES.detect]: detectHandler,
  }
}

/**
 * Register all settings routes on whichever web carrier the composition
 * exposes. Missing webServer is not fatal: the four model tools keep working.
 */
export function mountForgeRoutes(ctx, services) {
  const handlers = createHandlers(services)
  const disposers = []

  const tryRegister = (path, handler) => {
    const attempts = []
    try {
      const webServer = ctx.get?.('webServer')
      if (webServer !== undefined && typeof webServer.register === 'function') {
        attempts.push(() => webServer.register({ kind: 'exact', path, handler }))
      }
    } catch { /* no web carrier */ }
    try {
      const operatorCtx = ctx.get?.('connection')?.operator?.ctx
      const operatorWeb = operatorCtx?.get?.('webServer')
      if (operatorWeb !== undefined && typeof operatorWeb.register === 'function') {
        attempts.push(() => operatorWeb.register({ kind: 'exact', path, handler }))
      }
    } catch { /* no connection scope */ }
    let lastError
    for (const attempt of attempts) {
      try {
        const dispose = attempt()
        return typeof dispose === 'function' ? dispose : () => {}
      } catch (error) {
        lastError = error
      }
    }
    return { error: lastError ?? new Error('webServer service is unavailable') }
  }

  for (const [path, handler] of Object.entries(handlers)) {
    const result = tryRegister(path, handler)
    if (typeof result === 'function') {
      disposers.push(result)
      ctx.logger?.debug?.(`[revbayes-forge] route registered: ${path}`)
    } else {
      ctx.logger?.warn?.(`[revbayes-forge] could not register ${path}: ${result.error?.message ?? 'unknown error'}`)
    }
  }

  if (disposers.length === 0) {
    ctx.logger?.warn?.('[revbayes-forge] settings routes unavailable; model tools still work')
  }
  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* already released */ }
    }
  }
}

export { readJsonBody, MAX_BODY_BYTES }
