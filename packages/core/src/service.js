/**
 * `revbayesForge` service (coreApi = 1).
 *
 * Owns the pack registry and lifecycle, the shared block registry, cross-pack
 * generation, and coverage reporting. Packs never register tools themselves:
 * they register a manifest and the core controller enables/disables the tool
 * surface, dependency checks, and analysis availability.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateScript } from './rev/static-validator.js'
import { createAssembly, createRecipe } from './assembly.js'
import * as blocks from './blocks/index.js'
import { createPackTool } from './tools/pack.js'
import { packEnabledByConfig } from './config.js'

export const CORE_API_VERSION = 1
export const CORE_TOOL_NAMES = Object.freeze([
  'revbayes_generate',
  'revbayes_validate',
  'revbayes_lookup',
  'revbayes_environment',
])

const PACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const MATURITIES = new Set(['experimental', 'golden', 'verified'])
const COVERAGE_PATH = fileURLToPath(new URL('./data/families.json', import.meta.url))

function manifestError(message) {
  const error = new Error(`revbayes-forge pack manifest: ${message}`)
  error.code = 'RB4001'
  return error
}

function assert(condition, message) {
  if (!condition) throw manifestError(message)
}

function compareVersions(a, b) {
  const left = String(a).split('-')[0].split('.').map(Number)
  const right = String(b).split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0)
  }
  return 0
}

/** Validate a pack manifest's syntax and uniqueness rules. */
export function validatePackManifest(pack) {
  assert(pack !== null && typeof pack === 'object' && !Array.isArray(pack), 'manifest must be an object')
  assert(typeof pack.id === 'string' && PACK_ID_PATTERN.test(pack.id), `id must be kebab-case, got ${JSON.stringify(pack.id)}`)
  assert(typeof pack.version === 'string' && VERSION_PATTERN.test(pack.version), `version must be semver, got ${JSON.stringify(pack.version)}`)
  assert(pack.coreApi === CORE_API_VERSION, `coreApi must be ${CORE_API_VERSION}, got ${JSON.stringify(pack.coreApi)}`)
  assert(MATURITIES.has(pack.maturity), `maturity must be experimental, golden, or verified, got ${JSON.stringify(pack.maturity)}`)
  assert(typeof pack.title === 'string' && pack.title.trim().length > 0, 'title is required')
  assert(Array.isArray(pack.analyses) && pack.analyses.length > 0, 'analyses must be a non-empty array')
  const analysisIds = new Set()
  for (const analysis of pack.analyses) {
    assert(analysis !== null && typeof analysis === 'object', 'each analysis must be an object')
    assert(typeof analysis.id === 'string' && /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(analysis.id), `analysis id must be lower-case with underscores or dashes, got ${JSON.stringify(analysis.id)}`)
    assert(!analysisIds.has(analysis.id), `duplicate analysis id ${analysis.id}`)
    analysisIds.add(analysis.id)
    assert(analysis.maturity === undefined || MATURITIES.has(analysis.maturity), `analysis ${analysis.id} has invalid maturity`)
    const requires = analysis.requires ?? []
    assert(Array.isArray(requires) && requires.every((item) => typeof item === 'string' && PACK_ID_PATTERN.test(item)), `analysis ${analysis.id} requires must be an array of pack ids`)
  }
  assert(Array.isArray(pack.tools) && pack.tools.length > 0, 'tools must be a non-empty array')
  const toolNames = new Set()
  for (const tool of pack.tools) {
    assert(tool !== null && typeof tool === 'object', 'each tool must be an object')
    assert(typeof tool.name === 'string' && /^[a-z][a-z0-9_]*$/.test(tool.name), `tool name is invalid: ${JSON.stringify(tool.name)}`)
    assert(!toolNames.has(tool.name), `duplicate tool name ${tool.name}`)
    assert(!CORE_TOOL_NAMES.includes(tool.name), `pack may not replace core tool ${tool.name}`)
    assert(tool.name !== 'run_code', 'pack tools may not be named run_code')
    toolNames.add(tool.name)
  }
  const dependencies = pack.dependencies ?? []
  assert(Array.isArray(dependencies), 'dependencies must be an array')
  for (const dependency of dependencies) {
    assert(dependency !== null && typeof dependency === 'object' && typeof dependency.pack === 'string' && PACK_ID_PATTERN.test(dependency.pack), 'dependency.pack must be a pack id')
    assert(dependency.pack !== pack.id, `pack ${pack.id} may not depend on itself`)
    assert(dependency.minVersion === undefined || VERSION_PATTERN.test(dependency.minVersion), `dependency ${dependency.pack} has invalid minVersion`)
    assert(dependency.optional === undefined || typeof dependency.optional === 'boolean', `dependency ${dependency.pack} optional must be boolean`)
  }
  assert(typeof pack.generate === 'function', 'generate(spec, ctx) is required')
  assert(pack.validateSpec === undefined || typeof pack.validateSpec === 'function', 'validateSpec must be a function when present')
  assert(pack.runtime === undefined || typeof pack.runtime === 'object', 'runtime must be an object when present')
  return pack
}

function dependenciesOf(pack) {
  const edges = new Set()
  for (const dependency of pack.dependencies ?? []) edges.add(dependency.pack)
  for (const analysis of pack.analyses ?? []) {
    for (const required of analysis.requires ?? []) edges.add(required)
  }
  return [...edges]
}

function dependencyEdges(pack) {
  return dependenciesOf(pack)
}

/** Order packs so dependencies are enabled before their dependents. */
function orderByDependencies(manifests, ids) {
  const selected = new Set(ids)
  const graph = new Map(manifests.map((pack) => [pack.id, dependencyEdges(pack).filter((id) => selected.has(id))]))
  const ordered = []
  const visiting = new Set()
  const visited = new Set()
  const visit = (id) => {
    if (visited.has(id) || !selected.has(id)) return
    if (visiting.has(id)) return
    visiting.add(id)
    for (const next of graph.get(id) ?? []) visit(next)
    visiting.delete(id)
    visited.add(id)
    ordered.push(id)
  }
  for (const id of ids) visit(id)
  return ordered
}

function hasCycle(manifests, candidate) {
  const graph = new Map(manifests.map((pack) => [pack.id, dependenciesOf(pack)]))
  graph.set(candidate.id, dependenciesOf(candidate))
  const visiting = new Set()
  const visited = new Set()
  const visit = (id) => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of graph.get(id) ?? []) {
      if (graph.has(next) && visit(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  for (const id of graph.keys()) if (visit(id)) return true
  return false
}

function normalizeScriptResult(result, pack) {
  const diagnostics = [...(result.diagnostics ?? [])]
  const warnings = [...(result.warnings ?? [])]
  let artifacts = []
  if (Array.isArray(result.artifacts)) {
    artifacts = result.artifacts.map((item, index) => ({
      role: item.role ?? (index === 0 ? 'main' : 'artifact'),
      name: item.name ?? `${pack.id}_${index + 1}.Rev`,
      script: item.script,
    }))
  } else if (typeof result.script === 'string') {
    artifacts = [{ role: 'main', name: `${result.name ?? pack.id}.Rev`, script: result.script }]
  }
  const primaryScript = typeof result.primary_script === 'string'
    ? result.primary_script
    : (artifacts.find((item) => item.role === 'main') ?? artifacts[0])?.script ?? null
  return {
    ok: result.ok !== false,
    script: primaryScript,
    primary_script: primaryScript,
    artifacts,
    diagnostics,
    warnings,
    sections: result.sections ?? [],
    stats: result.stats ?? null,
    name: result.name ?? null,
    analysis: result.analysis ?? null,
  }
}

/**
 * Create the forge service.
 * @param {{config: object, catalog: object, logger?: object}} options
 */
export function createForge({ config, catalog, logger = null, stateStore = null }) {
  const packs = new Map()
  const blockRegistry = new Map()
  const activeTools = new Map()

  const currentBlockedAnalyses = (entry) => {
    const blocked = {}
    for (const analysis of entry.manifest.analyses) {
      const missing = (analysis.requires ?? []).filter((required) => packs.get(required)?.enabled !== true)
      if (missing.length > 0) blocked[analysis.id] = `requires pack ${missing.join(', ')}`
    }
    return blocked
  }

  const forge = {
    apiVersion: CORE_API_VERSION,
    config,
    catalog,
    blocks: { ...blocks, registry: blockRegistry },
    paths: Object.freeze({
      maxScriptBytes: config.maxScriptBytes,
      allowWriteOutsideWorkspace: config.allowWriteOutsideWorkspace,
    }),
    stateStore,
    get stateFile() {
      return stateStore?.file ?? null
    },

    assembly: {
      create: (context = {}) => createAssembly({ catalog, context }),
      recipe: (id) => createRecipe(forge, id),
      sectionBlock: blocks.sectionBlock,
      makeBlock: blocks.makeBlock,
    },

    validateScript: (source, options = {}) => validateScript(source, { catalog, ...options }),

    registerBlock(block) {
      if (block === null || typeof block !== 'object' || typeof block.id !== 'string') {
        throw new Error('registerBlock() expects a block with a string id')
      }
      if (blockRegistry.has(block.id)) throw new Error(`duplicate block ${block.id}`)
      blockRegistry.set(block.id, block)
      return () => blockRegistry.delete(block.id)
    },

    getBlock(id) {
      return blockRegistry.get(id) ?? null
    },

    registerPack(pack, ctx) {
      validatePackManifest(pack)
      if (packs.has(pack.id)) throw manifestError(`duplicate pack ${pack.id}`)
      for (const [otherId, other] of packs) {
        for (const tool of pack.tools) {
          if (other.manifest.tools.some((candidate) => candidate.name === tool.name)) {
            throw manifestError(`pack ${pack.id} reuses tool ${tool.name} from pack ${otherId}`)
          }
        }
        for (const analysis of pack.analyses) {
          if (other.manifest.analyses.some((candidate) => candidate.id === analysis.id)) {
            throw manifestError(`pack ${pack.id} reuses analysis ${analysis.id} from pack ${otherId}`)
          }
        }
      }
      if (hasCycle([...packs.values()].map((entry) => entry.manifest), pack)) {
        throw manifestError(`pack ${pack.id} introduces a dependency cycle`)
      }
      const entry = {
        manifest: pack,
        enabled: false,
        blocked: null,
        blockedAnalyses: {},
        toolDisposers: [],
        config: { ...(config.packConfig?.[pack.id] ?? {}) },
      }
      packs.set(pack.id, entry)
      logger?.debug?.(`[revbayes-forge] registered pack ${pack.id} ${pack.version}`)

      const checkDependencies = () => {
        for (const dependency of pack.dependencies ?? []) {
          const installed = packs.get(dependency.pack)
          if (installed === undefined) {
            if (dependency.optional === true) continue
            return `missing dependency pack ${dependency.pack}`
          }
          if (dependency.minVersion !== undefined && compareVersions(installed.manifest.version, dependency.minVersion) < 0) {
            return `dependency ${dependency.pack} ${installed.manifest.version} < ${dependency.minVersion}`
          }
          if (!installed.enabled) return `dependency ${dependency.pack} is installed but disabled`
        }
        return null
      }

      const controller = {
        pack: pack.id,
        get enabled() {
          return entry.enabled
        },
        get blocked() {
          return entry.blocked
        },
        enable() {
          if (entry.enabled) return { enabled: true, blocked: null }
          const blocked = checkDependencies()
          if (blocked !== null) {
            entry.blocked = blocked
            return { enabled: false, blocked }
          }
          entry.blocked = null
          entry.blockedAnalyses = currentBlockedAnalyses(entry)
          try {
            if (ctx?.tools?.register) {
              for (const tool of pack.tools) {
                const definition = createPackTool({ pack, toolSpec: tool, forge, packConfig: entry.config })
                const dispose = ctx.tools.register(defineTool(definition))
                entry.toolDisposers.push(typeof dispose === 'function' ? dispose : () => {})
                activeTools.set(tool.name, pack.id)
              }
            }
          } catch (error) {
            for (const dispose of entry.toolDisposers.splice(0)) {
              try { dispose() } catch { /* registration already failed */ }
            }
            activeTools.forEach((packId, name) => {
              if (packId === pack.id) activeTools.delete(name)
            })
            throw error
          }
          entry.enabled = true
          entry.blocked = null
          logger?.info?.(`[revbayes-forge] enabled pack ${pack.id}`)
          return { enabled: true, blocked: null }
        },
        disable() {
          for (const dispose of entry.toolDisposers.splice(0)) {
            try { dispose() } catch (error) { logger?.warn?.(`pack ${pack.id} tool disposer failed: ${error.message}`) }
          }
          for (const tool of pack.tools) activeTools.delete(tool.name)
          entry.enabled = false
          entry.blocked = null
          entry.blockedAnalyses = {}
          return { enabled: false }
        },
        dispose() {
          controller.disable()
          packs.delete(pack.id)
        },
      }
      entry.controller = controller
      return controller
    },

    /**
     * Apply one pack selection. Tools are unregistered and re-registered on
     * the core's own DSH context, so the model-facing tool surface follows the
     * selection immediately. Dependencies are enabled first and a dependent
     * pack that cannot be satisfied stays disabled (blocked), never half-on.
     */
    reconfigure(input = {}, options = {}) {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        const error = new Error('reconfigure() expects an object with enabledPacks and optional packConfig')
        error.code = 'RB4100'
        throw error
      }
      const selector = input.enabledPacks ?? config.enabledPacks
      const installedIds = [...packs.keys()]
      let requested
      if (Array.isArray(selector)) {
        requested = [...new Set(selector)]
        if (!requested.every((id) => typeof id === 'string' && PACK_ID_PATTERN.test(id))) {
          const error = new Error('enabledPacks must be an array of pack ids')
          error.code = 'RB4101'
          throw error
        }
      } else if (selector === 'all') {
        requested = installedIds
      } else if (selector === 'none') {
        requested = []
      } else if (selector === 'default' || selector === undefined) {
        requested = [...packs.values()]
          .filter((entry) => entry.manifest.maturity === 'verified')
          .map((entry) => entry.manifest.id)
      } else {
        const error = new Error('enabledPacks must be "default", "all", "none", or an array of pack ids')
        error.code = 'RB4101'
        throw error
      }

      const unknown = requested.filter((id) => !packs.has(id))
      if (unknown.length > 0 && options.ignoreUnknown !== true) {
        const error = new Error(`unknown pack(s): ${unknown.join(', ')}`)
        error.code = 'RB4102'
        error.path = 'enabledPacks'
        throw error
      }
      requested = requested.filter((id) => packs.has(id))

      let packConfig = input.packConfig ?? config.packConfig ?? {}
      if (packConfig === null || typeof packConfig !== 'object' || Array.isArray(packConfig)) {
        const error = new Error('packConfig must be an object keyed by pack id')
        error.code = 'RB4103'
        error.path = 'packConfig'
        throw error
      }
      for (const [id, value] of Object.entries(packConfig)) {
        if (!PACK_ID_PATTERN.test(id) || value === null || typeof value !== 'object' || Array.isArray(value)) {
          const error = new Error(`packConfig.${id} must be an object and the key must be a pack id`)
          error.code = 'RB4103'
          error.path = `packConfig.${id}`
          throw error
        }
      }

      const manifests = [...packs.values()].map((entry) => entry.manifest)
      const currentlyEnabled = [...packs.values()].filter((entry) => entry.enabled).map((entry) => entry.manifest.id)
      for (const id of orderByDependencies(manifests, currentlyEnabled).reverse()) {
        packs.get(id)?.controller.disable()
      }
      for (const entry of packs.values()) {
        entry.config = { ...(packConfig[entry.manifest.id] ?? {}) }
      }

      const blocked = []
      for (const id of orderByDependencies(manifests, requested)) {
        const outcome = packs.get(id).controller.enable()
        if (!outcome.enabled) blocked.push({ id, reason: outcome.blocked ?? 'blocked' })
      }

      config.enabledPacks = [...requested]
      config.packConfig = Object.fromEntries(Object.entries(packConfig).map(([id, value]) => [id, { ...value }]))

      let persisted = false
      if (stateStore !== null && options.persist === true) {
        stateStore.write({ enabledPacks: requested, packConfig: config.packConfig })
        persisted = true
      }

      logger?.info?.(`[revbayes-forge] pack selection applied: ${requested.length} requested, ${blocked.length} blocked, ${activeTools.size} pack tool(s) active`)
      return {
        ok: true,
        requested: [...requested],
        enabledPacks: [...packs.values()].filter((entry) => entry.enabled).map((entry) => entry.manifest.id),
        blocked,
        activeTools: [...activeTools.keys()],
        persisted,
        stateFile: stateStore?.file ?? null,
        restartRequired: false,
      }
    },

    requestedPackIds() {
      const selector = config.enabledPacks
      if (Array.isArray(selector)) return [...selector]
      if (selector === 'all') return [...packs.keys()]
      if (selector === 'none') return []
      return [...packs.values()].filter((entry) => entry.manifest.maturity === 'verified').map((entry) => entry.manifest.id)
    },

    enabledPackIds() {
      return [...packs.values()].filter((entry) => entry.enabled).map((entry) => entry.manifest.id)
    },

    listPacks() {
      return [...packs.values()].map((entry) => {
        const blockedAnalyses = currentBlockedAnalyses(entry)
        entry.blockedAnalyses = blockedAnalyses
        return {
        id: entry.manifest.id,
        version: entry.manifest.version,
        coreApi: entry.manifest.coreApi,
        maturity: entry.manifest.maturity,
        title: entry.manifest.title,
        description: entry.manifest.description ?? '',
        installed: true,
        enabled: entry.enabled,
        blocked: entry.blocked,
        blockedAnalyses: { ...blockedAnalyses },
        analyses: entry.manifest.analyses.map((analysis) => ({
          id: analysis.id,
          title: analysis.title ?? analysis.id,
          maturity: analysis.maturity ?? entry.manifest.maturity,
          requires: analysis.requires ?? [],
          blocked: blockedAnalyses[analysis.id] ?? null,
        })),
        tools: entry.manifest.tools.map((tool) => tool.name),
        dependencies: (entry.manifest.dependencies ?? []).map((dependency) => {
          const target = packs.get(dependency.pack)
          return {
            pack: dependency.pack,
            minVersion: dependency.minVersion ?? null,
            optional: dependency.optional === true,
            installed: target !== undefined,
            enabled: target?.enabled === true,
            version: target?.manifest.version ?? null,
            satisfied: target !== undefined && target.enabled === true,
          }
        }),
        workflow: entry.manifest.workflow ?? null,
        runtime: entry.manifest.runtime ?? null,
        blocks: entry.manifest.blocks ?? [],
      }})
    },

    isPackEnabled(id, maturityHint = null) {
      const entry = packs.get(id)
      const maturity = maturityHint ?? entry?.manifest.maturity ?? null
      return packEnabledByConfig(config, id, maturity)
    },

    isPackActive(id) {
      return packs.get(id)?.enabled === true
    },

    getPack(id) {
      const entry = packs.get(id)
      if (entry === undefined) return null
      return entry.controller
    },

    getPackManifest(id) {
      return packs.get(id)?.manifest ?? null
    },

    activeToolNames() {
      return [...activeTools.keys()]
    },

    /**
     * Generate a script from a registered pack. Used by workflow/orchestrator
     * packs so they never import another pack.
     */
    generateByPack(packId, analysisId, spec = {}, ctx = {}) {
      const entry = packs.get(packId)
      if (entry === undefined) {
        return {
          ok: false,
          script: null,
          diagnostics: [{ severity: 'error', code: 'RB4002', source: 'forge', message: `pack "${packId}" is not installed.`, suggestion: 'Install the pack or use base_script instead of base_spec.' }],
          sections: [],
          stats: null,
        }
      }
      if (!entry.enabled) {
        return {
          ok: false,
          script: null,
          diagnostics: [{ severity: 'error', code: 'RB4003', source: 'forge', message: `pack "${packId}" is installed but not enabled.`, suggestion: 'Enable the pack in enabledPacks.' }],
          sections: [],
          stats: null,
        }
      }
      const analysis = entry.manifest.analyses.find((item) => item.id === analysisId)
      if (analysis === undefined) {
        return {
          ok: false,
          script: null,
          diagnostics: [{ severity: 'error', code: 'RB4004', source: 'forge', message: `pack "${packId}" has no analysis "${analysisId}".`, suggestion: `Available analyses: ${entry.manifest.analyses.map((item) => item.id).join(', ')}.` }],
          sections: [],
          stats: null,
        }
      }
      const blockedReason = currentBlockedAnalyses(entry)[analysisId]
      if (blockedReason !== undefined) {
        return {
          ok: false,
          script: null,
          diagnostics: [{ severity: 'error', code: 'RB4005', source: 'forge', message: `analysis "${analysisId}" is blocked: ${blockedReason}.`, suggestion: 'Install and enable the required pack.' }],
          sections: [],
          stats: null,
        }
      }
      const result = normalizeScriptResult(
        entry.manifest.generate({ ...spec, analysis: analysisId }, { forge, config: entry.config, catalog, ctx }),
        entry.manifest,
      )
      const diagnostics = [...result.diagnostics]
      if (typeof result.script === 'string') {
        const validation = validateScript(result.script, { catalog, checkFiles: false, strict: true })
        diagnostics.push(...validation.diagnostics)
      }
      const ok = result.ok && diagnostics.every((item) => item.severity !== 'error')
      return { ...result, ok, diagnostics }
    },

    reportCoverage() {
      let families = []
      let meta = {}
      try {
        const data = JSON.parse(readFileSync(COVERAGE_PATH, 'utf8'))
        families = data.families ?? []
        meta = data.meta ?? {}
      } catch {
        families = []
      }
      const installed = new Set(['core'])
      for (const id of packs.keys()) {
        installed.add(id)
        installed.add(`pack-${id}`)
      }
      // Package directories do not always match pack ids (pack-dating-clock -> dating).
      if (packs.has('dating')) installed.add('pack-dating-clock')
      const uncovered = families
        .filter((family) => (family.owners ?? []).some((owner) => !installed.has(owner)))
        .map((family) => family.id)
      return {
        coreApi: CORE_API_VERSION,
        packs: forge.listPacks(),
        families,
        meta,
        unprotectedFamilies: uncovered,
      }
    },

    findRevBayes(options = {}) {
      return import('./rev/runtime.js').then((module) => module.findRevBayes(options))
    },
  }

  forge.diagnoseRuntime = (input) => import('./rev/diagnostics.js').then((module) => module.diagnoseRuntime(input))
  forge.applyFixes = (source, diagnostics, options = {}) => import('./rev/static-validator.js').then((module) => module.applyFixes(source, diagnostics, options))
  forge.runRevBayes = (options = {}) => import('./rev/runtime.js').then((module) => module.runRevBayes(options))

  return forge
}
