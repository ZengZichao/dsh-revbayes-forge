/**
 * Plugin configuration. Kept dependency-free so the package can load in any
 * DSH composition; the loader passes the raw YAML object to apply().
 */
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({
  revbayesBinary: '',
  allowRuntime: true,
  defaultMode: 'auto',
  defaultRuntimeMode: 'dry',
  timeoutMs: 120000,
  maxRunGenerations: 100,
  keepTemp: false,
  tempRoot: '',
  catalogPath: '',
  workspace: '',
  stateFile: '',
  strict: false,
  checkFiles: true,
  maxDiagnostics: 50,
  maxScriptBytes: 1024 * 1024,
  allowWriteOutsideWorkspace: false,
  enabledPacks: 'default',
  packConfig: {},
})

const MODES = new Set(['auto', 'static', 'dry', 'smoke'])
const RUNTIME_MODES = new Set(['dry', 'smoke'])
const PACK_SELECTORS = new Set(['default', 'all', 'none'])
const PACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function expandHome(value) {
  if (!value.startsWith('~/')) return value
  return resolve(homedir(), value.slice(2))
}

function error(message) {
  return new Error(`revbayes-forge config: ${message}`)
}

function boolOf(raw, key, fallback, errors) {
  if (raw[key] === undefined) return fallback
  if (typeof raw[key] !== 'boolean') {
    errors.push(`${key} must be a boolean`)
    return fallback
  }
  return raw[key]
}

function intOf(raw, key, fallback, min, max, errors) {
  if (raw[key] === undefined) return fallback
  const value = raw[key]
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${key} must be an integer between ${min} and ${max}`)
    return fallback
  }
  return value
}

function stringOf(raw, key, fallback, errors) {
  if (raw[key] === undefined) return fallback
  if (typeof raw[key] !== 'string') {
    errors.push(`${key} must be a string`)
    return fallback
  }
  return raw[key].trim()
}

/**
 * Normalize and validate a raw configuration object.
 * @param {object} raw
 * @returns {object}
 */
export function normalizeConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw error('configuration must be a mapping')
  }
  const errors = []
  const config = {
    revbayesBinary: expandHome(stringOf(raw, 'revbayesBinary', DEFAULT_CONFIG.revbayesBinary, errors)),
    allowRuntime: boolOf(raw, 'allowRuntime', DEFAULT_CONFIG.allowRuntime, errors),
    defaultMode: stringOf(raw, 'defaultMode', DEFAULT_CONFIG.defaultMode, errors),
    defaultRuntimeMode: stringOf(raw, 'defaultRuntimeMode', DEFAULT_CONFIG.defaultRuntimeMode, errors),
    timeoutMs: intOf(raw, 'timeoutMs', DEFAULT_CONFIG.timeoutMs, 1000, 30 * 60 * 1000, errors),
    maxRunGenerations: intOf(raw, 'maxRunGenerations', DEFAULT_CONFIG.maxRunGenerations, 1, 100000, errors),
    keepTemp: boolOf(raw, 'keepTemp', DEFAULT_CONFIG.keepTemp, errors),
    tempRoot: expandHome(stringOf(raw, 'tempRoot', DEFAULT_CONFIG.tempRoot, errors)),
    catalogPath: expandHome(stringOf(raw, 'catalogPath', DEFAULT_CONFIG.catalogPath, errors)),
    workspace: expandHome(stringOf(raw, 'workspace', DEFAULT_CONFIG.workspace, errors)),
    stateFile: expandHome(stringOf(raw, 'stateFile', DEFAULT_CONFIG.stateFile, errors)),
    strict: boolOf(raw, 'strict', DEFAULT_CONFIG.strict, errors),
    checkFiles: boolOf(raw, 'checkFiles', DEFAULT_CONFIG.checkFiles, errors),
    maxDiagnostics: intOf(raw, 'maxDiagnostics', DEFAULT_CONFIG.maxDiagnostics, 1, 500, errors),
    maxScriptBytes: intOf(raw, 'maxScriptBytes', DEFAULT_CONFIG.maxScriptBytes, 1024, 10 * 1024 * 1024, errors),
    allowWriteOutsideWorkspace: boolOf(raw, 'allowWriteOutsideWorkspace', DEFAULT_CONFIG.allowWriteOutsideWorkspace, errors),
    enabledPacks: normalizeEnabledPacks(raw.enabledPacks, errors),
    packConfig: normalizePackConfig(raw.packConfig, errors),
  }
  if (!MODES.has(config.defaultMode)) errors.push(`defaultMode must be one of ${[...MODES].join(', ')}`)
  if (!RUNTIME_MODES.has(config.defaultRuntimeMode)) errors.push(`defaultRuntimeMode must be one of ${[...RUNTIME_MODES].join(', ')}`)
  if (config.catalogPath.length > 0 && !isAbsolute(config.catalogPath)) {
    errors.push('catalogPath must be an absolute path (or empty for the bundled catalog)')
  }
  if (config.tempRoot.length === 0) config.tempRoot = tmpdir()
  if (config.workspace.length === 0) config.workspace = process.cwd()
  if (errors.length > 0) throw error(errors.join('; '))
  return config
}

function normalizeEnabledPacks(value, errors) {
  if (value === undefined) return DEFAULT_CONFIG.enabledPacks
  if (typeof value === 'string') {
    if (!PACK_SELECTORS.has(value)) {
      errors.push('enabledPacks must be "default", "all", "none", or an array of pack ids')
      return DEFAULT_CONFIG.enabledPacks
    }
    return value
  }
  if (!Array.isArray(value)) {
    errors.push('enabledPacks must be "default", "all", "none", or an array of pack ids')
    return DEFAULT_CONFIG.enabledPacks
  }
  const ids = []
  for (const item of value) {
    if (typeof item !== 'string' || !PACK_ID_PATTERN.test(item)) {
      errors.push(`enabledPacks contains an invalid pack id: ${JSON.stringify(item)}`)
      continue
    }
    if (!ids.includes(item)) ids.push(item)
  }
  return ids
}

function normalizePackConfig(value, errors) {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('packConfig must be a mapping from pack id to a configuration object')
    return {}
  }
  const out = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!PACK_ID_PATTERN.test(id)) {
      errors.push(`packConfig key is not a valid pack id: ${JSON.stringify(id)}`)
      continue
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`packConfig.${id} must be a mapping`)
      continue
    }
    out[id] = { ...entry }
  }
  return out
}

/**
 * Decide whether a pack is enabled by configuration alone. When maturity is
 * supplied, the `default` selector enables only verified packs.
 */
export function packEnabledByConfig(config, id, maturity = null) {
  const selector = config.enabledPacks ?? 'default'
  if (selector === 'all') return true
  if (selector === 'none') return false
  if (Array.isArray(selector)) return selector.includes(id)
  return maturity === 'verified'
}

/** Pack ids listed in an explicit `enabledPacks` array. */
export function configuredPackIds(config) {
  return Array.isArray(config.enabledPacks) ? [...config.enabledPacks] : []
}

/** Per-call overrides for runtime options. */
export function resolveRuntimeOverrides(config, args = {}) {
  const timeoutMs = args.timeout_ms === undefined ? config.timeoutMs : args.timeout_ms
  const maxRunGenerations = args.max_generations === undefined ? config.maxRunGenerations : args.max_generations
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30 * 60 * 1000) {
    throw new Error('timeout_ms must be an integer between 1000 and 1800000')
  }
  if (!Number.isInteger(maxRunGenerations) || maxRunGenerations < 1 || maxRunGenerations > 100000) {
    throw new Error('max_generations must be an integer between 1 and 100000')
  }
  return {
    binary: args.binary !== undefined && args.binary.length > 0 ? expandHome(args.binary) : config.revbayesBinary,
    timeoutMs,
    maxRunGenerations,
    keepTemp: args.keep_temp === undefined ? config.keepTemp : args.keep_temp,
    tempRoot: config.tempRoot,
  }
}

export { MODES, RUNTIME_MODES }
