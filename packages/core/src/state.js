/**
 * Persistent pack selection for the settings page.
 *
 * DSH does not expose a stable runtime API for writing plugin config, so the
 * UI-owned selection is kept in a dedicated file under DSH_HOME. The profile's
 * cordis.patch.yml is never rewritten. Writes are atomic (temp file + rename)
 * so a crash cannot leave a half-written state file.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const STATE_VERSION = 1

const PACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** DSH_HOME root used by the running deployment. */
export function dshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured.length > 0 ? resolve(configured) : join(homedir(), '.dsh')
}

/** Default state file: $DSH_HOME/revbayes-forge/state.json. */
export function defaultStateFile(env = process.env) {
  return join(dshHome(env), 'revbayes-forge', 'state.json')
}

function sanitizePackConfig(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!PACK_ID_PATTERN.test(id)) continue
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    out[id] = { ...entry }
  }
  return out
}

/** Validate and normalize a state document; returns null when unusable. */
export function normalizeState(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!Array.isArray(raw.enabledPacks)) return null
  if (!raw.enabledPacks.every((id) => typeof id === 'string' && PACK_ID_PATTERN.test(id))) return null
  const enabledPacks = [...new Set(raw.enabledPacks)]
  return {
    version: STATE_VERSION,
    enabledPacks,
    packConfig: sanitizePackConfig(raw.packConfig),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

/**
 * Create a state store bound to one file.
 * @param {{file?: string, env?: object, logger?: object}} [options]
 */
export function createStateStore(options = {}) {
  const file = options.file !== undefined
    ? (isAbsolute(options.file) ? options.file : resolve(options.file))
    : defaultStateFile(options.env ?? process.env)
  const logger = options.logger ?? null

  return {
    file,

    read() {
      try {
        if (!existsSync(file)) return null
        return normalizeState(JSON.parse(readFileSync(file, 'utf8')))
      } catch (error) {
        logger?.warn?.(`[revbayes-forge] ignoring unreadable state file ${file}: ${error.message}`)
        return null
      }
    },

    write(state) {
      const normalized = normalizeState({
        ...state,
        version: STATE_VERSION,
        updatedAt: new Date().toISOString(),
      })
      if (normalized === null) throw new Error('revbayes-forge state must contain a valid enabledPacks array')
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.tmp-${process.pid}-${Date.now()}`
      try {
        writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
        renameSync(temp, file)
      } catch (error) {
        try { rmSync(temp, { force: true }) } catch { /* best effort */ }
        throw error
      }
      return normalized
    },
  }
}
