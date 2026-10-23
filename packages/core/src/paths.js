/**
 * Path resolution helpers. Relative paths follow the calling agent's session
 * workspace; absolute writes are refused outside that workspace unless the
 * deployment explicitly allows them.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** The calling agent's workspace directory, or the process cwd. */
export function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/** Resolve a user-supplied path against an explicit base. */
export function resolveUserPath(path, base) {
  if (typeof path !== 'string' || path.trim().length === 0) throw new Error('path must be a non-empty string')
  return isAbsolute(path) ? resolve(path) : resolve(base, path)
}

/** Whether `target` is inside `root` (including root itself). */
export function isWithin(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Check that a write target is allowed by policy. */
export function assertWriteAllowed(target, workspace, allowOutside) {
  if (allowOutside === true) return
  if (!isWithin(workspace, target)) {
    throw new Error(`refusing to write outside the workspace (${workspace}): ${target}. Set allowWriteOutsideWorkspace=true to permit this.`)
  }
}

export function fileInfo(path) {
  try {
    const stat = statSync(path)
    return { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size }
  } catch {
    return { exists: false, isFile: false, isDirectory: false, size: 0 }
  }
}

export { existsSync, dirname }
