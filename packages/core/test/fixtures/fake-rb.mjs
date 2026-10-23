#!/usr/bin/env node
// Minimal RevBayes stand-in for runtime tests. It reads the first positional
// script, prints a version, and fails on scripts containing a MARKER.
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.includes('--version') || args.includes('-v')) {
  console.log('RevBayes version 1.3.0-test')
  process.exit(0)
}
const script = args.find((a) => !a.startsWith('-'))
if (script === undefined) {
  console.error('Error:\tNo script file given.')
  process.exit(2)
}
const source = readFileSync(script, 'utf8')
if (source.includes('FORGE_FAKE_FAILURE')) {
  console.error("Error:\tNo overloaded function 'dnJC' matches for arguments ( Natural )")
  console.error('   Potentially matching functions are:')
  console.error('   fnJC (Natural<any> num_states)')
  process.exit(1)
}
if (source.includes('FORGE_FAKE_VARIABLE')) {
  console.error('Missing Variable:\tVariable typo_variable does not exist')
  process.exit(1)
}
if (source.includes('FORGE_FAKE_SLOW')) {
  setTimeout(() => { console.log('slow done') }, 5000)
} else {
  const activeRun = source.split('\n').filter((line) => !line.trimStart().startsWith('#') && /\.run\s*\(/.test(line))
  console.log(`fake rb: active run statements = ${activeRun.length}`)
  for (const line of activeRun) console.log(`fake rb run: ${line.trim()}`)
}
