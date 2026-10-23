#!/usr/bin/env node
/**
 * Build the bundled RevBayes signature catalog from the RevBayes website source
 * (`_data/help.yml`). The generated JSON is committed so the plugin has no
 * build-time or network dependency.
 *
 * Usage:
 *   node scripts/build-catalog.mjs [--help-yml <path>] [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const helpPath = resolve(argOf('--help-yml') ?? resolve(root, '..', 'dsh-revbayes-forge-参考项目', 'revbayes.github.io-source', '_data', 'help.yml'))
const outPath = resolve(argOf('--out') ?? resolve(root, 'src', 'data', 'revbayes-signatures.json'))

/** Split a signature parameter list on top-level commas. */
function splitParams(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  const tail = text.slice(start).trim()
  if (tail.length > 0) parts.push(tail)
  return parts.filter((p) => p.length > 0)
}

/** Strip generic annotations from a Rev type token. */
function cleanType(type) {
  return type
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * Parse one parameter segment such as
 * `String<any> treetype {valid options: "clock"|"non-clock"}`.
 */
function parseParamSegment(segment) {
  const optionMatch = segment.match(/\{valid options:\s*([^}]*)\}/)
  const options = optionMatch
    ? [...optionMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : undefined
  const variadic = /\.\.\.\s*$/.test(segment) || segment.trim() === '...'
  let text = segment.replace(/\{[^}]*\}/g, '').trim().replace(/\s*\.\.\.\s*$/, '').trim()
  if (text.length === 0) return null
  const tokens = text.split(/\s+/)
  let name = tokens.at(-1)
  let type = tokens.slice(0, -1).join('')
  // A segment may be just a type (unnamed positional argument).
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /[<>[\]|]/.test(name)) {
    type = text
    name = null
  }
  return {
    name,
    type: cleanType(type || 'RevObject'),
    variadic,
    options,
  }
}

/** Parse a usage string into its callable name and parameters. */
function parseUsage(usage) {
  if (typeof usage !== 'string') return null
  const trimmed = usage.trim()
  const open = trimmed.indexOf('(')
  const close = trimmed.lastIndexOf(')')
  if (open < 0 || close <= open) return null
  const name = trimmed.slice(0, open).trim()
  const list = trimmed.slice(open + 1, close)
  return {
    name,
    params: list.trim().length === 0 ? [] : splitParams(list).map(parseParamSegment).filter(Boolean),
  }
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) return []
  return args.map((a) => ({
    name: a.label ?? null,
    type: cleanType(a.value_type ?? 'RevObject'),
    description: typeof a.description === 'string' ? a.description.trim() : '',
    default: a.default ?? null,
    options: Array.isArray(a.options) ? a.options : undefined,
    variadic: a.label === null || a.label === undefined,
  }))
}

/** Merge YAML argument metadata with the parsed usage. */
function signatureFrom(usage, args, origin) {
  const parsed = parseUsage(usage)
  if (parsed === null) return null
  const meta = normalizeArgs(args)
  const params = parsed.params.map((p, i) => {
    const byName = p.name === null ? undefined : meta.find((m) => m.name === p.name)
    const byIndex = meta[i]
    const source = byName ?? byIndex ?? {}
    const options = p.options ?? source.options
    const required = !p.variadic
      && source.default === null
      && source.default !== 'NULL'
      && !(source.variadic === true && p.name === null)
    return {
      name: p.name,
      type: p.type || source.type || 'RevObject',
      description: source.description ?? '',
      default: source.default ?? null,
      options: options ?? null,
      variadic: p.variadic || source.variadic === true,
      required,
    }
  })
  // A few help entries omit a default for an argument that is optional in
  // practice (it follows the documented alternative/optional argument).
  const optionalOverrides = {
    readTreeTrace: ['separator'],
    readTaxonData: ['separator'],
    readAncestralStateTrace: ['separator'],
    ConditionalPosteriorOrdinate: ['separator'],
    loadPlugin: ['path'],
    readMatrix: ['separator'],
    readStochasticVariableTrace: ['separator'],
    readRelativeNodeAgeConstraints: ['separator'],
    readAncestralStateTreeTrace: ['separator'],
    readDataDelimitedFile: ['separator'],
    readDataDelimitedFile2: ['separator'],
  }
  for (const optionalName of optionalOverrides[parsed.name] ?? []) {
    const param = params.find((p) => p.name === optionalName)
    if (param !== undefined) param.required = false
  }
  return { origin, usage: usage.trim(), name: parsed.name, params }
}

function kindOf(entry) {
  const spec = entry.type_spec ?? []
  if (spec.includes('Function')) return 'function'
  if (spec.includes('Distribution')) return 'distribution'
  if (spec.includes('Move')) return 'move'
  if (spec.includes('Monitor')) return 'monitor'
  if (spec.includes('Function')) return 'function'
  return 'constructor'
}

function trimText(value, max) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length === 0) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const raw = YAML.parse(readFileSync(helpPath, 'utf8'))
if (!Array.isArray(raw)) throw new Error(`unexpected help.yml shape: ${typeof raw}`)

const entries = {}
const aliases = {}
for (const doc of raw) {
  if (doc === null || typeof doc !== 'object' || typeof doc.name !== 'string') continue
  const name = doc.name.trim()
  if (name.length === 0) continue
  const signatures = []
  const top = signatureFrom(doc.usage, doc.arguments, 'function')
  if (top !== null) signatures.push(top)
  for (const ctor of Array.isArray(doc.constructor) ? doc.constructor : []) {
    const sig = signatureFrom(ctor?.usage, ctor?.arguments, 'constructor')
    if (sig !== null) signatures.push(sig)
  }
  const methods = []
  for (const method of Array.isArray(doc.methods) ? doc.methods : []) {
    const sig = signatureFrom(method?.usage, method?.arguments, 'method')
    if (sig === null) continue
    methods.push({
      ...sig,
      name: method.name ?? sig.name,
      returnType: method.return_type ?? null,
      owner: name,
    })
  }
  const merged = entries[name] ?? {
    name,
    title: null,
    kinds: [],
    typeSpec: [],
    returnType: null,
    signatures: [],
    methods: [],
    description: null,
    example: null,
    seeAlso: [],
    aliases: [],
  }
  merged.title = merged.title ?? trimText(doc.title, 300)
  merged.returnType = merged.returnType ?? (typeof doc.return_type === 'string' ? doc.return_type : null)
  merged.description = merged.description ?? trimText(doc.description, 1200)
  merged.example = merged.example ?? trimText(doc.example, 2400)
  merged.typeSpec = [...new Set([...merged.typeSpec, ...(Array.isArray(doc.type_spec) ? doc.type_spec : [])])]
  const kind = kindOf(doc)
  if (!merged.kinds.includes(kind)) merged.kinds.push(kind)
  for (const sig of signatures) {
    if (!merged.signatures.some((s) => s.usage === sig.usage)) merged.signatures.push(sig)
  }
  for (const m of methods) {
    if (!merged.methods.some((s) => s.owner === m.owner && s.name === m.name && s.usage === m.usage)) merged.methods.push(m)
  }
  for (const item of Array.isArray(doc.see_also) ? doc.see_also : []) {
    if (typeof item === 'string' && !merged.seeAlso.includes(item)) merged.seeAlso.push(item)
  }
  const docAliases = Array.isArray(doc.aliases)
    ? doc.aliases
    : typeof doc.aliases === 'string' ? [doc.aliases] : []
  for (const alias of docAliases) {
    if (typeof alias === 'string' && alias.trim().length > 0 && alias.trim() !== name) {
      const a = alias.trim()
      if (!merged.aliases.includes(a)) merged.aliases.push(a)
      aliases[a] = name
    }
  }
  entries[name] = merged
}

const catalog = {
  meta: {
    schemaVersion: 1,
    generator: 'scripts/build-catalog.mjs',
    source: 'revbayes.github.io-source/_data/help.yml',
    entries: Object.keys(entries).length,
    functions: Object.values(entries).filter((e) => e.kinds.includes('function')).length,
    constructors: Object.values(entries).filter((e) => e.kinds.some((k) => k !== 'function')).length,
    methods: Object.values(entries).reduce((n, e) => n + e.methods.length, 0),
    signatures: Object.values(entries).reduce((n, e) => n + e.signatures.length, 0),
  },
  entries,
  aliases,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(catalog, null, 1)}\n`, 'utf8')
console.log(`wrote ${outPath}`)
console.log(JSON.stringify(catalog.meta, null, 2))
