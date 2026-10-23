/** Pack tool wrapper: core owns validation, output contract, and file writes. */
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { resolveUserPath, sessionCwd, assertWriteAllowed } from '../paths.js'
import { DIAGNOSTIC_OUTPUT, codeFence, formatDiagnostics, summarizeDiagnostics } from './shared.js'

function normalizeSchemaNode(node) {
  if (node === null || typeof node !== 'object') return node
  if (node.type === 'object' && node.additionalProperties === undefined) node.additionalProperties = true
  for (const key of ['properties', 'items', 'oneOf', 'anyOf', 'allOf']) {
    const value = node[key]
    if (Array.isArray(value)) {
      for (const item of value) normalizeSchemaNode(item)
    } else if (value !== null && typeof value === 'object') {
      if (key === 'properties') {
        for (const child of Object.values(value)) normalizeSchemaNode(child)
      } else {
        normalizeSchemaNode(value)
      }
    }
  }
  return node
}

function specProperties(toolSpec) {
  if (toolSpec === null || typeof toolSpec !== 'object') return {}
  let properties = {}
  if (typeof toolSpec.parameters === 'function') properties = toolSpec.parameters()
  else if (toolSpec.parameters !== null && typeof toolSpec.parameters === 'object') properties = toolSpec.parameters
  for (const value of Object.values(properties)) normalizeSchemaNode(value)
  return properties
}

function inputSchema(toolSpec) {
  const properties = specProperties(toolSpec)
  return {
    spec: {
      type: 'object',
      required: true,
      additionalProperties: true,
      description: toolSpec?.specDescription ?? 'Structured analysis specification. The exact fields depend on the analysis.',
      properties,
    },
    output_path: {
      type: 'string',
      description: 'File path for a single-script pack, or a directory for workflow packs with multiple artifacts. Relative paths resolve against the session workspace.',
    },
    overwrite: { type: 'boolean', description: 'Overwrite existing output files (default false).' },
  }
}

export const PACK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    primary_script: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    artifacts: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', required: true },
          name: { type: 'string', required: true },
          script: { type: 'string', required: true },
        },
      },
    },
    diagnostics: { type: 'array', items: DIAGNOSTIC_OUTPUT, required: true },
    warnings: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, message: { type: 'string', required: true } } }, required: true },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        error: { type: 'number', required: true },
        warning: { type: 'number', required: true },
        info: { type: 'number', required: true },
      },
    },
    sections: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { name: { type: 'string', required: true } } }, required: true },
    stats: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    written: { type: 'boolean', required: true },
    paths: { type: 'array', items: { type: 'string' }, required: true },
  },
}

function safeArtifactName(name, fallback) {
  const base = basename(String(name ?? '').replaceAll('\\', '/'))
  if (base.length === 0 || base === '.' || base === '..') return fallback
  return base
}

function renderReport(value) {
  const lines = []
  if (value.ok) lines.push(`Generated ${value.artifacts.length} artifact(s)${value.paths.length > 0 ? ` → ${value.paths.join(', ')}` : ' (not written; pass output_path to save)'} .`)
  else lines.push('Generation failed; fix the diagnostics below.')
  if (value.stats !== null && typeof value.stats === 'object') {
    const stats = value.stats
    lines.push(`Stats: ${stats.lines ?? '?'} lines, ${stats.bytes ?? '?'} bytes, ${stats.moves ?? '?'} move statements, ${stats.monitors ?? '?'} monitors.`)
  }
  if (value.warnings.length > 0) {
    lines.push('', 'Warnings:', ...value.warnings.map((warning) => `- ${warning.code ?? 'warning'}: ${warning.message}`))
  }
  const diagnostics = value.diagnostics.filter((item) => item.severity !== 'info')
  if (diagnostics.length > 0) lines.push('', 'Diagnostics:', formatDiagnostics(diagnostics, 30))
  for (const artifact of value.artifacts) {
    lines.push('', `Artifact ${artifact.role}: ${artifact.name}`, codeFence(artifact.script, 'rev'))
  }
  return lines.join('\n')
}

function finalize(pack, toolSpec, result, diagnostics, warnings, written = false, paths = []) {
  const summary = summarizeDiagnostics(diagnostics)
  return {
    ok: result.ok !== false && summary.error === 0,
    primary_script: result.primary_script ?? result.script ?? null,
    artifacts: result.artifacts ?? (result.script ? [{ role: 'main', name: `${result.name ?? pack.id}.Rev`, script: result.script }] : []),
    diagnostics,
    warnings,
    summary,
    sections: result.sections ?? [],
    stats: result.stats ?? null,
    written,
    paths,
  }
}

/** Create a DSH tool definition for one pack tool. */
export function createPackTool({ pack, toolSpec, forge, packConfig = {} }) {
  return {
    name: toolSpec.name,
    description: toolSpec.description ?? `Generate a ${pack.title} analysis from a structured spec.`,
    parameters: inputSchema(toolSpec),
    output: {
      schema: PACK_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const workspace = sessionCwd(exec)
      const diagnostics = []
      const warnings = []
      const requestedAnalysis = typeof args.spec?.analysis === 'string' ? args.spec.analysis : pack.analyses[0]?.id
      const analysis = pack.analyses.find((item) => item.id === requestedAnalysis)
      if (analysis !== undefined) {
        const missing = (analysis.requires ?? []).filter((required) => !forge.isPackActive?.(required))
        if (missing.length > 0) {
          diagnostics.push({
            severity: 'error',
            code: 'RB4005',
            source: `pack:${pack.id}`,
            message: `analysis "${analysis.id}" requires pack(s) ${missing.join(', ')}, which are not installed or not enabled.`,
            suggestion: 'Install and enable the required pack, or choose an analysis that does not need it.',
          })
          return finalize(pack, toolSpec, { ok: false, diagnostics: [], artifacts: [] }, diagnostics, warnings)
        }
      }
      const generated = pack.generate(args.spec ?? {}, { forge, config: packConfig, catalog: forge.catalog, workspace })
      let normalized = generated
      if (!Array.isArray(normalized.artifacts) && typeof normalized.script === 'string') {
        normalized = {
          ...normalized,
          artifacts: [{ role: 'main', name: `${normalized.name ?? pack.id}.Rev`, script: normalized.script }],
        }
      }
      if (Array.isArray(normalized.artifacts)) {
        const checked = []
        for (const artifact of normalized.artifacts) {
          const validation = forge.validateScript(artifact.script, { checkFiles: false, strict: true })
          diagnostics.push(...validation.diagnostics)
          checked.push(artifact)
        }
        normalized.artifacts = checked
      }
      diagnostics.unshift(...(normalized.diagnostics ?? []))
      warnings.push(...(normalized.warnings ?? []))
      const beforeWrite = finalize(pack, toolSpec, normalized, diagnostics, warnings)
      if (!beforeWrite.ok || typeof args.output_path !== 'string' || args.output_path.trim().length === 0) {
        return beforeWrite
      }

      let target
      try {
        target = resolveUserPath(args.output_path, workspace)
        assertWriteAllowed(target, workspace, forge.config.allowWriteOutsideWorkspace)
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: `${pack.diagnostics?.prefix ?? 'RB'}5800`,
          source: `pack:${pack.id}`,
          message: error.message,
          suggestion: 'Use a path inside the session workspace, or enable allowWriteOutsideWorkspace.',
        })
        return finalize(pack, toolSpec, normalized, diagnostics, warnings)
      }

      const artifacts = normalized.artifacts ?? []
      const isDirectory = artifacts.length > 1
        || args.output_path.endsWith('/')
        || args.output_path.endsWith('\\')
        || (existsSync(target) && statSync(target).isDirectory())
      const paths = []
      const writeDiagnostics = []
      const seen = new Set()
      for (let index = 0; index < artifacts.length; index += 1) {
        const artifact = artifacts[index]
        const name = safeArtifactName(artifact.name, `${pack.id}_${index + 1}.Rev`)
        if (seen.has(name)) {
          writeDiagnostics.push({
            severity: 'error', code: `${pack.diagnostics?.prefix ?? 'RB'}5801`, source: `pack:${pack.id}`,
            message: `duplicate artifact file name ${name}`, suggestion: 'Give each artifact a unique name.',
          })
          continue
        }
        seen.add(name)
        const path = isDirectory ? join(target, name) : target
        if (existsSync(path) && args.overwrite !== true) {
          writeDiagnostics.push({
            severity: 'error', code: `${pack.diagnostics?.prefix ?? 'RB'}5802`, source: `pack:${pack.id}`,
            message: `refusing to overwrite existing file: ${path}`, suggestion: 'Pass overwrite=true or choose another output path.',
          })
          continue
        }
        try {
          mkdirSync(dirname(path), { recursive: true })
          const temp = `${path}.tmp-${process.pid}`
          writeFileSync(temp, artifact.script, 'utf8')
          renameSync(temp, path)
          paths.push(path)
        } catch (error) {
          writeDiagnostics.push({
            severity: 'error', code: `${pack.diagnostics?.prefix ?? 'RB'}5803`, source: `pack:${pack.id}`,
            message: `could not write ${path}: ${error.message}`,
          })
        }
      }
      diagnostics.push(...writeDiagnostics)
      return finalize(pack, toolSpec, normalized, diagnostics, warnings, paths.length === artifacts.length && artifacts.length > 0, paths)
    },
  }
}
