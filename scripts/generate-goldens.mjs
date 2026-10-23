#!/usr/bin/env node
/**
 * Regenerate canonical golden scripts from fixtures/canonical.json.
 * Packs that compose other packs (TED) are generated with an enabled forge.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../packages/core/src/rev/catalog.js'
import { createForge } from '../packages/core/src/service.js'
import { normalizeConfig } from '../packages/core/src/config.js'
import { validateScript } from '../packages/core/src/rev/static-validator.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = loadCatalog()
let failed = 0

for (const dir of readdirSync(join(root, 'packages')).filter((name) => name.startsWith('pack-') && name !== 'pack-ted')) {
  const fixturePath = join(root, 'packages', dir, 'fixtures', 'canonical.json')
  let fixture
  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  } catch {
    continue
  }
  const { manifest } = await import(`../packages/${dir}/src/manifest.js`)
  for (const entry of fixture.canonical ?? []) {
    const result = manifest.generate(entry.spec, { catalog, config: {}, forge: null })
    const script = result.script
    if (!result.ok || typeof script !== 'string') {
      console.error(`FAIL ${dir}/${entry.name}: ${(result.diagnostics ?? []).map((item) => item.message).join('; ')}`)
      failed += 1
      continue
    }
    const validation = validateScript(script, { catalog, checkFiles: false, strict: true })
    if (validation.summary.error > 0) {
      console.error(`FAIL ${dir}/${entry.name}: strict validation errors`)
      for (const diagnostic of validation.diagnostics.filter((item) => item.severity === 'error')) console.error(`  ${diagnostic.code} ${diagnostic.message}`)
      failed += 1
      continue
    }
    writeFileSync(join(root, 'packages', dir, 'fixtures', 'golden', entry.golden ?? `${entry.name}.Rev`), `${script}\n`)
    console.log(`wrote ${dir}/${entry.golden ?? `${entry.name}.Rev`}`)
  }
}

const forge = createForge({ config: normalizeConfig({ enabledPacks: ['fbd', 'dating', 'ted'] }), catalog })
const tedFixture = JSON.parse(readFileSync(join(root, 'packages', 'pack-ted', 'fixtures', 'canonical.json'), 'utf8'))
const { manifest: fbd } = await import('../packages/pack-fbd/src/manifest.js')
const { manifest: dating } = await import('../packages/pack-dating-clock/src/manifest.js')
const { manifest: ted } = await import('../packages/pack-ted/src/manifest.js')
const ctx = { tools: { register: () => () => {} } }
for (const pack of [fbd, dating, ted]) forge.registerPack(pack, ctx).enable()
for (const entry of tedFixture.canonical ?? []) {
  const result = ted.generate(entry.spec, { catalog, config: {}, forge })
  if (!result.ok || typeof result.script !== 'string') {
    console.error(`FAIL pack-ted/${entry.name}: ${(result.diagnostics ?? []).map((item) => item.message).join('; ')}`)
    failed += 1
    continue
  }
  const validation = validateScript(result.script, { catalog, checkFiles: false, strict: true })
  if (validation.summary.error > 0) {
    console.error(`FAIL pack-ted/${entry.name}: strict validation errors`)
    failed += 1
    continue
  }
  writeFileSync(join(root, 'packages', 'pack-ted', 'fixtures', 'golden', entry.golden ?? `${entry.name}.Rev`), `${result.script}\n`)
  console.log(`wrote pack-ted/${entry.golden ?? `${entry.name}.Rev`}`)
}

if (failed > 0) {
  console.error(`\n${failed} golden generation failure(s)`)
  process.exit(1)
}
console.log('goldens regenerated')
