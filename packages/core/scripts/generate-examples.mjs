#!/usr/bin/env node
/** Regenerate examples/*.Rev from examples/specs/*.json. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../src/rev/catalog.js'
import { generateScript } from '../src/rev/generator.js'
import { validateScript } from '../src/rev/static-validator.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples')
const examples = root
const specs = join(examples, 'specs')
const catalog = loadCatalog()
const outputs = {
  'dna-jc-uniform.json': 'dna_jc_uniform.Rev',
  'dna-gtr-g-i.json': 'dna_gtr_g_i.Rev',
  'dna-fixed-tree.json': 'dna_fixed_tree.Rev',
  'morphology-mk.json': 'morphology_mk.Rev',
  'partition-dna.json': 'partition_dna.Rev',
}
let failed = 0
for (const [specFile, scriptFile] of Object.entries(outputs)) {
  const spec = JSON.parse(readFileSync(join(specs, specFile), 'utf8'))
  const result = generateScript(spec, { catalog, baseDir: examples })
  if (!result.ok) {
    failed += 1
    console.error(`${specFile}: generation failed`, result.diagnostics.filter((d) => d.severity === 'error'))
    continue
  }
  writeFileSync(join(examples, scriptFile), result.script, 'utf8')
  const validation = validateScript(result.script, { catalog, baseDir: examples, checkFiles: true, strict: true })
  if (!validation.ok) {
    failed += 1
    console.error(`${specFile}: strict validation failed`, validation.diagnostics)
  } else {
    console.log(`wrote ${scriptFile} (${result.script.split('\n').length} lines, ${validation.summary.warning} warning(s))`)
  }
}
if (failed > 0) process.exit(1)
