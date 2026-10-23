#!/usr/bin/env node
/** Run every workspace test file under packages/<pkg>/test/*.test.js. */
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = []
for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const testDir = join(root, 'packages', entry.name, 'test')
  if (!existsSync(testDir)) continue
  for (const name of readdirSync(testDir)) {
    if (name.endsWith('.test.js')) files.push(join(testDir, name))
  }
}
files.sort()
if (files.length === 0) {
  console.error('no test files found')
  process.exit(1)
}
console.log(`running ${files.length} test files`)
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root })
process.exit(result.status ?? 1)
