/**
 * Public helpers for model packs. Packs only use this module (exported from the
 * core package) to validate specs and render scripts; they never import core
 * internals.
 */
import { createAssembly, sectionBlock, sectionTag } from '../assembly.js'

export const PACK_FORMAT_VERSION = '0.1.0'

export class PackSpecError extends Error {
  constructor(code, message, path = null, suggestion = null) {
    super(message)
    this.name = 'PackSpecError'
    this.code = code
    this.path = path
    this.suggestion = suggestion
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function asObject(value, path, code) {
  if (!isPlainObject(value)) throw new PackSpecError(code, `${path} must be an object.`, path)
  return value
}

export function optionalObject(value, path, code) {
  if (value === undefined || value === null) return {}
  return asObject(value, path, code)
}

export function asString(value, path, { code, defaultValue, required = false, allowEmpty = false, enumValues = null } = {}) {
  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return defaultValue
    if (required) throw new PackSpecError(code, `${path} is required.`, path)
    return null
  }
  if (typeof value !== 'string') throw new PackSpecError(code, `${path} must be a string.`, path)
  const trimmed = value.trim()
  if (!allowEmpty && trimmed.length === 0) {
    if (defaultValue !== undefined) return defaultValue
    throw new PackSpecError(code, `${path} must be a non-empty string.`, path)
  }
  if (enumValues !== null && !enumValues.includes(trimmed)) {
    throw new PackSpecError(code, `${path} must be one of ${enumValues.join(', ')}, but got ${JSON.stringify(trimmed)}.`, path)
  }
  return trimmed
}

export function asNumber(value, path, { code, defaultValue, min = -Infinity, max = Infinity, exclusiveMin = false, exclusiveMax = false } = {}) {
  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return defaultValue
    throw new PackSpecError(code, `${path} is required and must be a number.`, path)
  }
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) throw new PackSpecError(code, `${path} must be a finite number, but got ${JSON.stringify(value)}.`, path)
  if (exclusiveMin ? number <= min : number < min) {
    throw new PackSpecError(code, `${path} must be ${exclusiveMin ? '>' : '>='} ${min}, but got ${number}.`, path)
  }
  if (exclusiveMax ? number >= max : number > max) {
    throw new PackSpecError(code, `${path} must be ${exclusiveMax ? '<' : '<='} ${max}, but got ${number}.`, path)
  }
  return number
}

export function asInteger(value, path, options = {}) {
  const number = asNumber(value, path, options)
  if (!Number.isInteger(number)) throw new PackSpecError(options.code, `${path} must be an integer, but got ${number}.`, path)
  return number
}

export function asProbability(value, path, { code, defaultValue, allowOne = false } = {}) {
  return asNumber(value, path, { code, defaultValue, min: 0, max: allowOne ? 1 : 1, exclusiveMax: !allowOne })
}

export function asBoolean(value, path, { code, defaultValue } = {}) {
  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return defaultValue
    throw new PackSpecError(code, `${path} is required and must be a boolean.`, path)
  }
  if (typeof value !== 'boolean') throw new PackSpecError(code, `${path} must be a boolean.`, path)
  return value
}

export function asStringArray(value, path, { code, defaultValue, minLength = 0, unique = true } = {}) {
  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return [...defaultValue]
    throw new PackSpecError(code, `${path} is required and must be an array of strings.`, path)
  }
  if (!Array.isArray(value)) throw new PackSpecError(code, `${path} must be an array of strings.`, path)
  const values = value.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new PackSpecError(code, `${path} must contain non-empty strings.`, path)
    }
    return item.trim()
  })
  if (values.length < minLength) throw new PackSpecError(code, `${path} must contain at least ${minLength} item(s).`, path)
  if (unique && new Set(values).size !== values.length) {
    throw new PackSpecError(code, `${path} must not contain duplicates.`, path)
  }
  return values
}

export function sanitizeName(value, fallback = 'revbayes_analysis') {
  const name = String(value ?? '').trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '')
  return name.length > 0 ? name : fallback
}

/** Normalize the analysis id, name, data file, and MCMC block shared by packs. */
export function normalizeBaseSpec(spec, {
  source,
  code,
  analyses,
  defaultAnalysis = null,
  defaultName = null,
  requireDataFile = true,
}) {
  asObject(spec, 'spec', code)
  const analysis = spec.analysis === undefined || spec.analysis === null
    ? (defaultAnalysis ?? analyses[0])
    : String(spec.analysis).trim().toLowerCase()
  if (!analyses.includes(analysis)) {
    throw new PackSpecError(code, `analysis must be one of ${analyses.join(', ')}, but got ${JSON.stringify(spec.analysis)}.`, 'analysis')
  }
  const rawName = spec.name ?? defaultName ?? `${source}_${analysis}`
  const name = sanitizeName(rawName, `${source}_${analysis}`)
  const data = optionalObject(spec.data, 'data', code)
  const file = requireDataFile
    ? asString(data.file, 'data.file', { code, required: true })
    : asString(data.file, 'data.file', { code, defaultValue: null })
  return { analysis, name, data, file }
}

/** Normalize MCMC settings with family-independent defaults. */
export function normalizeMcmc(raw, { code, defaultGenerations = 20000 } = {}) {
  const mcmc = optionalObject(raw, 'mcmc', code)
  const generations = asInteger(mcmc.generations, 'mcmc.generations', { code, defaultValue: defaultGenerations, min: 1, max: 1e12 })
  const sampleEvery = asInteger(mcmc.sample_every, 'mcmc.sample_every', { code, defaultValue: 10, min: 1, max: 1e9 })
  const screenEvery = asInteger(mcmc.screen_every, 'mcmc.screen_every', { code, defaultValue: 100, min: 1, max: 1e9 })
  const tuningInterval = asInteger(mcmc.tuning_interval, 'mcmc.tuning_interval', { code, defaultValue: Math.min(100, generations), min: 1, max: 1e9 })
  const nruns = asInteger(mcmc.nruns, 'mcmc.nruns', { code, defaultValue: 1, min: 1, max: 16 })
  const combine = asString(mcmc.combine, 'mcmc.combine', { code, defaultValue: 'mixed', enumValues: ['sequential', 'mixed', 'none'] })
  const moveschedule = asString(mcmc.moveschedule, 'mcmc.moveschedule', { code, defaultValue: 'random', enumValues: ['random', 'sequential', 'single'] })
  const outputDir = asString(mcmc.output_dir, 'mcmc.output_dir', { code, defaultValue: 'output', allowEmpty: true })
  const prefixName = typeof raw?.prefix === 'string' && raw.prefix.trim().length > 0 ? sanitizeName(raw.prefix, '') : ''
  const prefix = outputDir.length === 0
    ? prefixName
    : (prefixName.length === 0 ? `${outputDir}/` : `${outputDir}/${prefixName}`)
  return {
    generations,
    sampleEvery,
    screenEvery,
    tuningInterval,
    nruns,
    combine,
    moveschedule,
    outputDir,
    prefix,
  }
}

export function section(title, order, lines) {
  return { title, order, lines }
}

/** Render sections with the same banner style as the core generator. */
export function renderSections({ name, analysis, dataFile = null, title = null, sections, includeHeader = true }) {
  const header = []
  if (includeHeader) {
    header.push(...[
      '################################################################################',
      `# ${name}`,
      title === null ? null : `# ${title}`,
      `# Generated by dsh-revbayes-forge ${PACK_FORMAT_VERSION}`,
      `# Analysis: ${analysis}`,
      dataFile === null ? null : `# Data: ${dataFile}`,
      '#',
      '# Review this script and the paths before running it. The data file must be',
      '# readable from the working directory in which RevBayes is started.',
      '################################################################################',
      '',
    ].filter((line) => line !== null))
  }
  const assembly = createAssembly({})
  sections.forEach((item, index) => {
    assembly.add(sectionBlock({ id: `pack.section.${index}`, title: item.title, order: index, lines: item.lines }))
  })
  const body = assembly.finish()
  const lines = includeHeader ? [...header, '', ...body.script.split('\n')] : body.script.split('\n')
  const offset = includeHeader ? header.length + 1 : 0
  const rendered = body.sections.map((entry) => ({
    name: entry.name,
    startLine: entry.startLine + offset,
    endLine: entry.endLine + offset,
  }))
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  const script = lines.join('\n')
  return {
    script,
    sections: rendered,
    stats: {
      lines: script.split('\n').length,
      bytes: Buffer.byteLength(script, 'utf8'),
      moves: (script.match(/moves\.append\(/g) ?? []).length,
      monitors: (script.match(/monitors\.append\(/g) ?? []).length,
    },
  }
}

/** Build the standard monitors + MCMC + quit tail used by most packs. */
export function mcmcTail({ mcmc, prefixBase, treeName = null, extraMonitors = [], extraScreen = [], monitorExclude = [], modelNode = 'mymodel_anchor' }) {
  const prefix = mcmc.prefix.length > 0 ? `${mcmc.prefix}${prefixBase}` : prefixBase
  const lines = []
  lines.push(`mymodel = model(${modelNode})`, '')
  const monitors = []
  monitors.push(`monitors.append( mnModel(filename=${JSON.stringify(`${prefix}.log`)}, printgen=${mcmc.sampleEvery}${monitorExclude.length > 0 ? `, exclude=${JSON.stringify(monitorExclude)}` : ''}) )`)
  if (treeName !== null) monitors.push(`monitors.append( mnFile(filename=${JSON.stringify(`${prefix}.trees`)}, printgen=${mcmc.sampleEvery}, ${treeName}) )`)
  monitors.push(...extraMonitors.map((item) => `monitors.append( ${item} )`))
  const screenArgs = [`printgen=${mcmc.screenEvery}`, ...extraScreen]
  monitors.push(`monitors.append( mnScreen(${screenArgs.join(', ')}) )`)
  lines.push(...monitors, '')
  const mcmcArgs = ['model=mymodel', 'monitors=monitors', 'moves=moves', `moveschedule=${JSON.stringify(mcmc.moveschedule)}`]
  if (mcmc.nruns > 1) mcmcArgs.push(`nruns=${mcmc.nruns}`, `combine=${JSON.stringify(mcmc.combine)}`)
  lines.push(`mymcmc = mcmc(${mcmcArgs.join(', ')})`)
  lines.push(`mymcmc.run(generations=${mcmc.generations}, tuningInterval=${mcmc.tuningInterval})`)
  lines.push('mymcmc.operatorSummary()', '', '# Quit RevBayes after the analysis', 'q()')
  return lines
}

export function movesMonitorPreamble(taxaExpression = null) {
  const lines = []
  if (taxaExpression !== null) lines.push(taxaExpression)
  lines.push('moves    = VectorMoves()', 'monitors = VectorMonitors()', '')
  return lines
}

/** Wrap pack-specific normalize/render logic into the standard generate result. */
export function buildPackScript(spec, { source, normalize, render }) {
  const diagnostics = []
  const warnings = []
  try {
    const normalized = normalize(spec, diagnostics, warnings)
    if (diagnostics.some((item) => item.severity === 'error')) {
      return { ok: false, script: null, diagnostics, warnings, sections: [], stats: null }
    }
    const generated = render(normalized, diagnostics, warnings)
    const script = generated.script
    const resultDiagnostics = [...diagnostics, ...(generated.diagnostics ?? [])]
    const ok = resultDiagnostics.every((item) => item.severity !== 'error')
    return {
      ok,
      script,
      ...(generated.primary_script === undefined ? {} : { primary_script: generated.primary_script }),
      ...(generated.artifacts === undefined ? {} : { artifacts: generated.artifacts }),
      diagnostics: resultDiagnostics,
      warnings: [...warnings, ...(generated.warnings ?? [])],
      sections: generated.sections ?? [],
      stats: generated.stats ?? null,
      name: normalized.name ?? null,
      analysis: normalized.analysis ?? null,
      spec: normalized,
    }
  } catch (error) {
    if (error instanceof PackSpecError) {
      diagnostics.push({
        severity: 'error',
        code: error.code,
        message: error.message,
        source,
        ...(error.path === null ? {} : { path: error.path }),
        ...(error.suggestion === null ? {} : { suggestion: error.suggestion }),
      })
      return { ok: false, script: null, diagnostics, warnings, sections: [], stats: null }
    }
    throw error
  }
}

/** Standard diagnostic object for a pack. */
export function packDiagnostic(source, code, severity, message, extra = {}) {
  return { severity, code, message, source, ...extra }
}

/** Derive a failure result for empty or invalid input. */
export function packFailure(diagnostics, source) {
  return {
    ok: false,
    script: null,
    diagnostics: diagnostics.map((item) => ({ source, ...item })),
    warnings: [],
    sections: [],
    stats: null,
  }
}

/** Fill manifest defaults shared by every pack. */
export function definePack(manifest) {
  return {
    version: PACK_FORMAT_VERSION,
    coreApi: 1,
    dependencies: [],
    blocks: [],
    runtime: { recommendedSmokeGenerations: 50, fixtures: [] },
    ...manifest,
  }
}

/** Normalize a named/expected analysis property used by workflow packs. */
export function artifact(role, name, script) {
  return { role, name: name.replace(/[^A-Za-z0-9_.-]+/g, '_'), script }
}
