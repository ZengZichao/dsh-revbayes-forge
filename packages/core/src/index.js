/**
 * dsh-revbayes-forge — host half (core).
 *
 * Registers four model-facing tools on the DSH tool registry:
 *   revbayes_generate     structured analysis spec -> validated Rev script
 *   revbayes_validate     static + dry/smoke validation and repair advice
 *   revbayes_lookup       bundled RevBayes help/signature catalog search
 *   revbayes_environment  binary/config/catalog/pack readiness
 *
 * All 13 model packs are internal modules of this single bundle. The plugin
 * owns their manifests, lifecycle, and tool registrations; enabling or
 * disabling a pack on the settings page re-registers exactly the affected
 * tools on this same DSH context.
 *
 * It also provides the `revbayesForge` service (coreApi = 1) and mounts the
 * settings HTTP surface under /plugins/dsh-revbayes-forge/.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadCatalog } from './rev/catalog.js'
import { normalizeConfig } from './config.js'
import { createForge } from './service.js'
import { createStateStore } from './state.js'
import { createGenerateTool } from './tools/generate.js'
import { createValidateTool } from './tools/validate.js'
import { createLookupTool } from './tools/lookup.js'
import { createEnvironmentTool } from './tools/environment.js'
import { BUILTIN_PACKS } from './packs/builtin/index.js'
import { mountForgeRoutes } from './host/routes.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-revbayes-forge'

/** The plugin is a tool consumer; without the registry it must not activate. */
export const inject = ['tools']

/**
 * Build the four core tool definitions without registering them.
 * Exported for tests and for callers that compose tools themselves.
 * @param {{config: object, catalog: object, forge?: object}} services
 */
export function createTools(services) {
  return [
    createGenerateTool(services),
    createValidateTool(services),
    createLookupTool(services),
    createEnvironmentTool(services),
  ]
}

function mountSettingsRoutes(ctx, services, logger) {
  const hostCtx = services.hostCtx ?? ctx
  try {
    const release = mountForgeRoutes(hostCtx, services)
    if (typeof hostCtx.effect === 'function') {
      hostCtx.effect(() => release, 'revbayes-forge: settings routes')
    }
  } catch (error) {
    logger?.warn?.(`[revbayes-forge] settings routes could not be mounted: ${error.message}`)
  }
}

/**
 * Cordis entry point.
 * @param {object} ctx plugin context carrying the tools service
 * @param {object} rawConfig profile configuration from cordis.patch.yml
 */
export function apply(ctx, rawConfig = {}) {
  const baseConfig = normalizeConfig(rawConfig)
  const stateStore = createStateStore({
    ...(baseConfig.stateFile.length > 0 ? { file: baseConfig.stateFile } : {}),
    logger: ctx.logger,
  })
  const persisted = stateStore.read()
  const config = persisted === null
    ? baseConfig
    : {
        ...baseConfig,
        enabledPacks: [...persisted.enabledPacks],
        packConfig: { ...baseConfig.packConfig, ...persisted.packConfig },
      }
  const catalog = loadCatalog(config.catalogPath.length > 0 ? config.catalogPath : null)
  const forge = createForge({ config, catalog, logger: ctx.logger, stateStore })
  ctx.provide?.('revbayesForge', forge)

  for (const pack of BUILTIN_PACKS) {
    forge.registerPack(pack, ctx)
  }
  forge.reconfigure(
    { enabledPacks: config.enabledPacks, packConfig: config.packConfig },
    { persist: false, ignoreUnknown: true },
  )
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const id of forge.enabledPackIds()) {
        try { forge.getPack(id)?.disable() } catch { /* unloading anyway */ }
      }
    }, 'revbayes-forge: pack tools')
  }

  const services = { config, catalog, forge, logger: ctx.logger, stateStore }
  for (const tool of createTools(services)) {
    ctx.tools.register(defineTool(tool))
  }

  const hosts = []
  if (ctx.get?.('webServer') !== undefined) hosts.push(ctx)
  else if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (hostCtx) => mountSettingsRoutes(hostCtx, services, ctx.logger))
  }
  for (const hostCtx of hosts) mountSettingsRoutes(hostCtx, services, ctx.logger)

  ctx.logger?.info?.(
    `[revbayes-forge] ${BUILTIN_PACKS.length} built-in packs, ${forge.enabledPackIds().length} enabled, `
    + `4 core tools + ${forge.activeToolNames().length} pack tools, ${catalog.meta.entries ?? '?'} catalog entries`,
  )
  return forge
}

export { normalizeConfig, loadCatalog, createForge, createStateStore }
export { validatePackManifest, CORE_API_VERSION, CORE_TOOL_NAMES } from './service.js'
export { createAssembly, createRecipe, makeBlock, sectionBlock, sectionTag } from './assembly.js'
export { findRevBayes, runRevBayes, checkEnvironment } from './rev/runtime.js'
export { validateScript, applyFixes } from './rev/static-validator.js'
export { diagnoseRuntime } from './rev/diagnostics.js'
export * from './packs/spec.js'
export { BUILTIN_PACKS, BUILTIN_PACK_IDS } from './packs/builtin/index.js'
export * as blocks from './blocks/index.js'
