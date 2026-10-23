/** Shared tool rendering helpers. */
import { relative } from 'node:path'

export function formatDiagnostic(diagnostic) {
  const location = diagnostic.line > 0
    ? `L${diagnostic.line}${diagnostic.column > 0 ? `:${diagnostic.column}` : ''}`
    : 'general'
  const parts = [`- [${diagnostic.severity.toUpperCase()}] ${diagnostic.code ?? ''} ${location}: ${diagnostic.message}`.replace('  ', ' ').trim()]
  if (diagnostic.suggestion !== undefined && diagnostic.suggestion !== null) parts.push(`  suggestion: ${diagnostic.suggestion}`)
  if (diagnostic.path !== undefined && diagnostic.path !== null) parts.push(`  field: ${diagnostic.path}`)
  return parts.join('\n')
}

export function formatDiagnostics(diagnostics, limit = 50) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return 'No diagnostics.'
  const shown = diagnostics.slice(0, limit)
  const lines = shown.map(formatDiagnostic)
  if (diagnostics.length > limit) lines.push(`- … ${diagnostics.length - limit} more diagnostic(s); raise max_diagnostics to see them.`)
  return lines.join('\n')
}

export function summarizeDiagnostics(diagnostics) {
  const summary = { error: 0, warning: 0, info: 0 }
  for (const diagnostic of diagnostics ?? []) summary[diagnostic.severity] = (summary[diagnostic.severity] ?? 0) + 1
  return summary
}

export function mergeDiagnostics(...lists) {
  const merged = []
  const seen = new Set()
  for (const list of lists) {
    for (const diagnostic of list ?? []) {
      const key = `${diagnostic.source ?? ''}:${diagnostic.code ?? ''}:${diagnostic.line ?? 0}:${diagnostic.message}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(diagnostic)
    }
  }
  return merged
}

export function codeFence(text, language = '') {
  return `\`\`\`${language}\n${text}\n\`\`\``
}

export function relativeDisplay(path, base) {
  if (typeof path !== 'string' || path.length === 0) return null
  try {
    const rel = relative(base, path)
    return rel.length > 0 && !rel.startsWith('..') ? rel : path
  } catch {
    return path
  }
}

export const DIAGNOSTIC_PROPERTIES = {
  severity: { type: 'string', required: true, enum: ['error', 'warning', 'info'] },
  code: { type: 'string' },
  message: { type: 'string', required: true },
  line: { type: 'number' },
  column: { type: 'number' },
  endLine: { type: 'number' },
  endColumn: { type: 'number' },
  source: { type: 'string' },
  suggestion: { type: 'string' },
  path: { type: 'string' },
  note: { type: 'string' },
  expected: { type: 'string' },
  providedCall: { type: 'string' },
  correctUsage: { type: 'string' },
}

export const DIAGNOSTIC_OUTPUT = {
  type: 'object',
  additionalProperties: true,
  properties: DIAGNOSTIC_PROPERTIES,
}

export function outputSchemaDiagnostics() {
  return { type: 'array', items: DIAGNOSTIC_OUTPUT }
}
