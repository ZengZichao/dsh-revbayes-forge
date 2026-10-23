#!/usr/bin/env node
/**
 * Run the generated examples through a real RevBayes binary in dry and smoke
 * mode. Not part of `npm test` because RevBayes is optional.
 *
 * Usage:
 *   node scripts/validate-runtime-examples.mjs --rb /path/to/rb
 *   REVBAYES_BIN=/path/to/rb node scripts/validate-runtime-examples.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRevBayes, runRevBayes } from '../src/rev/runtime.js'
import { loadCatalog } from '../src/rev/catalog.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const examples = join(root, '..', '..', 'examples')
const args = process.argv.slice(2)
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const requested = argOf('--rb') ?? process.env.REVBAYES_BIN ?? ''
const detection = findRevBayes({ binary: requested })
if (!detection.found) {
  console.error('RevBayes not found. Pass --rb /path/to/rb or set REVBAYES_BIN.')
  process.exit(2)
}
console.log(`RevBayes: ${detection.path}${detection.version !== null ? ` (${detection.version})` : ''}`)
const catalog = loadCatalog()
const files = ['dna_jc_uniform.Rev', 'dna_gtr_g_i.Rev', 'dna_fixed_tree.Rev', 'morphology_mk.Rev', 'partition_dna.Rev']
let failed = 0
for (const file of files) {
  const script = readFileSync(join(examples, file), 'utf8')
  for (const mode of ['dry', 'smoke']) {
    const result = await runRevBayes({
      binary: detection.path,
      script,
      baseDir: examples,
      mode,
      timeoutMs: 120000,
      maxRunGenerations: 50,
      catalog,
    })
    const status = result.ok ? 'ok' : 'FAIL'
    console.log(`${status.padEnd(4)} ${file} ${mode.padEnd(5)} exit=${result.exitCode} ${result.durationMs}ms`)
    for (const diagnostic of result.diagnostics) {
      console.log(`     ${diagnostic.severity} ${diagnostic.code} L${diagnostic.line}: ${diagnostic.message}`)
      if (diagnostic.suggestion) console.log(`       → ${diagnostic.suggestion}`)
    }
    if (!result.ok) failed += 1
  }
}
if (failed > 0) {
  console.error(`\n${failed} runtime check(s) failed`)
  process.exit(1)
}
console.log('\nall examples passed dry + smoke validation')
