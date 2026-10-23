#!/usr/bin/env node
/**
 * Static-validate the 544-script reference corpus. The corpus includes
 * deliberately broken test scripts and prose snippets; only the six documented
 * exceptions may fail. Any new error is a regression.
 *
 * Usage: node scripts/validate-corpus.mjs [--root <tutorial root>]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../packages/core/src/rev/catalog.js'
import { validateScript } from '../packages/core/src/rev/static-validator.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const corpusRoot = resolve(argOf('--root') ?? join(root, '..', 'dsh-revbayes-forge-参考项目'))
const catalog = loadCatalog()
const KNOWN_EXCEPTIONS = new Set([
  'tutorials/mcmc_troubleshooting/scripts/inference.Rev',
  'tutorials/mcmc_troubleshooting/scripts/models.Rev',
  'tutorials/mcmc_troubleshooting/scripts/moves.Rev',
  'tutorials/mcmc_troubleshooting/scripts/startingvals.Rev',
  'tutorials/model_selection_bayes_factors/scripts/marginal_likelihood_partition_1.Rev',
  'tutorials/model_selection_bayes_factors/scripts/marginal_likelihood_partition_4.Rev',
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.rev$/i.test(entry.name)) out.push(path)
  }
  return out
}

let files
try {
  files = walk(corpusRoot)
} catch (error) {
  console.log(`corpus not available at ${corpusRoot}; skipping (${error.message})`)
  process.exit(0)
}

let clean = 0
let errorFiles = 0
let errors = 0
let warnings = 0
let infos = 0
const unexpected = []
const exceptionsSeen = new Set()
for (const file of files) {
  let source
  try { source = readFileSync(file, 'utf8') } catch { continue }
  const result = validateScript(source, { catalog, baseDir: dirname(file), checkFiles: false, strict: false })
  if (result.ok) clean += 1
  else {
    errorFiles += 1
    const relFull = relative(corpusRoot, file).replaceAll('\\', '/')
    const tutorialIndex = relFull.indexOf('tutorials/')
    const rel = tutorialIndex >= 0 ? relFull.slice(tutorialIndex) : relFull
    if (KNOWN_EXCEPTIONS.has(rel)) exceptionsSeen.add(rel)
    else unexpected.push({ file: relFull, errors: result.diagnostics.filter((item) => item.severity === 'error').slice(0, 3) })
  }
  errors += result.summary.error
  warnings += result.summary.warning
  infos += result.summary.info
}

console.log(`corpus: ${corpusRoot}`)
console.log(`files: ${files.length}, clean: ${clean}, with errors: ${errorFiles}`)
console.log(`diagnostics: ${errors} error(s), ${warnings} warning(s), ${infos} info`)
console.log(`known non-valid scripts: ${exceptionsSeen.size}/${KNOWN_EXCEPTIONS.size}`)
if (unexpected.length > 0) {
  console.error('\nunexpected corpus errors:')
  for (const item of unexpected.slice(0, 20)) {
    console.error(`- ${item.file}`)
    for (const error of item.errors) console.error(`    ${error.code} ${error.message} (L${error.line})`)
  }
  process.exit(1)
}
if (clean < 538) {
  console.error(`\nexpected at least 538 clean scripts, got ${clean}`)
  process.exit(1)
}
console.log('\ncorpus gate passed')
