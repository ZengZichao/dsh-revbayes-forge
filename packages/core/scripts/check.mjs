#!/usr/bin/env node
/** Syntax-check every JavaScript module shipped in the plugin. */
import { readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (/\.(m?js)$/.test(entry.name)) files.push(path)
  }
}
for (const dir of ['src', 'scripts', 'test']) walk(join(root, dir))
let failed = 0
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    failed += 1
    console.error(`FAIL ${relative(root, file)}\n${result.stderr}`)
  }
}
if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax checks`)
  process.exit(1)
}
console.log(`checked ${files.length} JavaScript files`)
