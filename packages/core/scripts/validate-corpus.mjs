#!/usr/bin/env node
/**
 * Validate the reference corpus with the plugin's static validator.
 *
 * The corpus includes deliberately broken test scripts and prose snippets from
 * tutorials, so this is a signal report, not a pass/fail gate. It is the
 * calibration harness used while building the validator.
 *
 * Usage:
 *   node scripts/validate-corpus.mjs [--root <reference project>] [--strict]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../src/rev/catalog.js'
import { validateScript } from '../src/rev/static-validator.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const args = process.argv.slice(2)
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const corpusRoot = resolve(argOf('--root') ?? join(root, '..', '..', 'dsh-revbayes-forge-参考项目'))
const strict = args.includes('--strict')
const catalog = loadCatalog()

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.(Rev|rev)$/.test(entry.name)) out.push(path)
  }
  return out
}

let files
try {
  files = walk(corpusRoot)
} catch (error) {
  console.error(`Cannot read corpus root: ${corpusRoot}\n${error.message}`)
  process.exit(2)
}
const errorsByMessage = new Map()
let clean = 0
let errorFiles = 0
let errors = 0
let warnings = 0
let infos = 0
for (const file of files) {
  let source
  try { source = readFileSync(file, 'utf8') } catch { continue }
  const result = validateScript(source, { catalog, baseDir: dirname(file), checkFiles: false, strict })
  if (result.ok) clean += 1
  else errorFiles += 1
  errors += result.summary.error
  warnings += result.summary.warning
  infos += result.summary.info
  for (const diagnostic of result.diagnostics.filter((d) => d.severity === 'error')) {
    const key = `${diagnostic.code} ${diagnostic.message.replace(/'.*?'/g, "'X'").slice(0, 120)}`
    if (!errorsByMessage.has(key)) errorsByMessage.set(key, { count: 0, example: `${relative(corpusRoot, file)}:${diagnostic.line}` })
    errorsByMessage.get(key).count += 1
  }
}
console.log(`corpus: ${corpusRoot}`)
console.log(`files: ${files.length}, clean: ${clean}, with errors: ${errorFiles}`)
console.log(`diagnostics: ${errors} error(s), ${warnings} warning(s), ${infos} info`)
const top = [...errorsByMessage.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12)
if (top.length > 0) {
  console.log('\nremaining error clusters (corpus includes intentionally broken snippets):')
  for (const [message, meta] of top) console.log(`  ${meta.count}× ${message}\n     e.g. ${meta.example}`)
}
