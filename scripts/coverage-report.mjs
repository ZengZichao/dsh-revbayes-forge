#!/usr/bin/env node
/**
 * Coverage gate for the 18 analysis families and 304 tutorial scripts.
 * Validates coverage/families.yaml against coverage/tutorial-index.json,
 * package ownership, verified-pack runtime fixtures, and (when available) the
 * reference tutorial tree.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const checkMode = process.argv.includes('--check')
const argOf = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const MATURITIES = new Set(['verified', 'golden', 'experimental', 'mixed', 'validation'])
const EXPECTED_FAMILIES = 18
const EXPECTED_SCRIPTS = 304

function fail(message) {
  failures.push(message)
}

function readYaml(path) {
  return parse(readFileSync(path, 'utf8'))
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function countRevFiles(dir) {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) count += countRevFiles(path)
    else if (/\.rev$/i.test(entry.name)) count += 1
  }
  return count
}

const failures = []
const coverage = readYaml(join(root, 'coverage', 'families.yaml'))
const index = readJson(join(root, 'coverage', 'tutorial-index.json'))
const families = coverage.families ?? []

if (families.length !== EXPECTED_FAMILIES) fail(`expected ${EXPECTED_FAMILIES} families, found ${families.length}`)
const ids = new Set()
const mappedTutorials = new Map()
let scriptTotal = 0
for (const family of families) {
  if (ids.has(family.id)) fail(`duplicate family id ${family.id}`)
  ids.add(family.id)
  if (!MATURITIES.has(family.maturity)) fail(`family ${family.id} has invalid maturity ${family.maturity}`)
  if (!Array.isArray(family.owners) || family.owners.length === 0) fail(`family ${family.id} has no owner`)
  for (const owner of family.owners ?? []) {
    const dir = owner === 'core' ? join(root, 'packages', 'core') : join(root, 'packages', owner)
    if (!existsSync(dir)) fail(`family ${family.id} owner ${owner} has no package directory`)
  }
  if (!Array.isArray(family.tutorials) || family.tutorials.length === 0) fail(`family ${family.id} has no tutorials`)
  for (const tutorial of family.tutorials ?? []) {
    if (mappedTutorials.has(tutorial)) fail(`tutorial ${tutorial} is mapped to both ${mappedTutorials.get(tutorial)} and ${family.id}`)
    mappedTutorials.set(tutorial, family.id)
  }
  const expected = (family.tutorials ?? []).reduce((sum, tutorial) => sum + (index.tutorials[tutorial]?.count ?? index.tutorials[tutorial] ?? 0), 0)
  if (expected !== family.scripts) {
    fail(`family ${family.id} declares ${family.scripts} scripts but its tutorials contain ${expected}`)
  }
  scriptTotal += family.scripts
}
if (scriptTotal !== EXPECTED_SCRIPTS) fail(`family script total is ${scriptTotal}, expected ${EXPECTED_SCRIPTS}`)
if (index.total !== EXPECTED_SCRIPTS) fail(`tutorial index total is ${index.total}, expected ${EXPECTED_SCRIPTS}`)
for (const tutorial of Object.keys(index.tutorials)) {
  if (!mappedTutorials.has(tutorial)) fail(`tutorial directory ${tutorial} is not mapped to any family`)
}
for (const tutorial of mappedTutorials.keys()) {
  if (index.tutorials[tutorial] === undefined) fail(`family mapping references unknown tutorial ${tutorial}`)
}

// The core bundles a JSON mirror for revbayesForge.reportCoverage(); it must
// stay identical to the CI-reviewed YAML.
const runtimeFamiliesPath = join(root, 'packages', 'core', 'src', 'data', 'families.json')
if (!existsSync(runtimeFamiliesPath)) {
  fail('packages/core/src/data/families.json is missing')
} else {
  const runtime = readJson(runtimeFamiliesPath)
  const runtimeFamilies = runtime.families ?? []
  if (runtimeFamilies.length !== families.length) fail('runtime families.json family count differs from coverage/families.yaml')
  for (const family of families) {
    const mirror = runtimeFamilies.find((item) => item.id === family.id)
    if (mirror === undefined) {
      fail(`runtime families.json is missing family ${family.id}`)
      continue
    }
    if (mirror.scripts !== family.scripts) fail(`runtime families.json script count differs for ${family.id}`)
    if (mirror.maturity !== family.maturity) fail(`runtime families.json maturity differs for ${family.id}`)
    if ((mirror.owners ?? []).join(',') !== (family.owners ?? []).join(',')) fail(`runtime families.json owners differ for ${family.id}`)
    if ((mirror.tutorials ?? []).join(',') !== (family.tutorials ?? []).join(',')) fail(`runtime families.json tutorials differ for ${family.id}`)
  }
  if ((runtime.meta?.tutorialScripts ?? 0) !== EXPECTED_SCRIPTS) fail('runtime families.json meta.tutorialScripts must be 304')
}

// Core must let the DSH host provide dsh-tools as a single peer instance;
// bundling it into the profile splits the runtime scheduler symbol.
const corePkg = readJson(join(root, 'packages', 'core', 'package.json'))
if (corePkg.dependencies?.['@deepseek-ai/dsh-tools'] !== undefined) {
  fail('packages/core must not list @deepseek-ai/dsh-tools as a dependency; declare it as a peer')
}
if (corePkg.peerDependencies?.['@deepseek-ai/dsh-tools'] === undefined) {
  fail('packages/core must declare @deepseek-ai/dsh-tools in peerDependencies')
}

// Every tutorial with scripts has a row; every row's count matches the committed index.
for (const [tutorial, value] of Object.entries(index.tutorials)) {
  const count = typeof value === 'number' ? value : value.count
  if (!Number.isInteger(count) || count <= 0) fail(`tutorial index entry ${tutorial} has an invalid count`)
}

// All 13 packs are internal modules of the core bundle. Development packages
// keep fixtures/tests but must not expose a second DSH bundle.
const builtinDir = join(root, 'packages', 'core', 'src', 'packs', 'builtin')
const builtinIndex = readFileSync(join(builtinDir, 'index.js'), 'utf8')
const packMaturity = new Map()
let packCount = 0
for (const dir of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  if (!dir.isDirectory() || !dir.name.startsWith('pack-')) continue
  packCount += 1
  const base = join(root, 'packages', dir.name)
  const pkg = readJson(join(base, 'package.json'))
  const wrapperPath = join(base, 'src', 'manifest.js')
  if (!existsSync(wrapperPath)) {
    fail(`package ${dir.name} has no manifest.js`)
    continue
  }
  if (pkg.dsh !== undefined) fail(`package ${dir.name} must not declare DSH bundle metadata`)
  if (existsSync(join(base, 'src', 'index.js'))) fail(`package ${dir.name} must not keep a Cordis entry at src/index.js`)
  if (existsSync(join(base, 'cordis.patch.yml'))) fail(`package ${dir.name} must not keep a cordis.patch.yml`)
  const wrapper = readFileSync(wrapperPath, 'utf8')
  const id = wrapper.match(/dsh-revbayes-forge\/packs\/([a-z0-9-]+)/)?.[1]
  if (id === undefined) {
    fail(`package ${dir.name} must re-export an internal core pack module`)
    continue
  }
  const builtinPath = join(builtinDir, `${id}.js`)
  if (!existsSync(builtinPath)) {
    fail(`package ${dir.name} points at missing core pack module ${id}.js`)
    continue
  }
  if (!builtinIndex.includes(`from './${id}.js'`)) fail(`core builtin registry does not import ${id}.js`)
  const source = readFileSync(builtinPath, 'utf8')
  const maturityMatch = source.match(/maturity:\s*'(verified|golden|experimental)'/)
  const idMatch = source.match(/id:\s*'([a-z0-9-]+)'/)
  if (idMatch === null || idMatch[1] !== id) fail(`core pack module ${id}.js declares id ${idMatch?.[1] ?? '(missing)'}`)
  if (maturityMatch === null) fail(`core pack module ${id}.js has no maturity`)
  else packMaturity.set(id, maturityMatch[1])
  if (!source.includes("from '../spec.js'")) {
    fail(`core pack module ${id}.js must import helpers through the dependency-free pack-api module`)
  }
  if (/dsh-tools/.test(source)) fail(`core pack module ${id}.js must not import dsh-tools`)
  const canonicalPath = join(base, 'fixtures', 'canonical.json')
  const goldenDir = join(base, 'fixtures', 'golden')
  const runtimeTest = join(base, 'test', 'runtime.test.mjs')
  if (!existsSync(canonicalPath)) fail(`package ${dir.name} is missing fixtures/canonical.json`)
  if (!existsSync(goldenDir) || readdirSync(goldenDir).filter((name) => name.endsWith('.Rev')).length === 0) {
    fail(`package ${dir.name} has no golden .Rev fixture`)
  }
  if (maturityMatch?.[1] === 'verified') {
    if (!existsSync(runtimeTest)) fail(`verified package ${dir.name} has no runtime.test.mjs`)
    else {
      const testSource = readFileSync(runtimeTest, 'utf8')
      if (!testSource.includes("mode: 'dry'") || !testSource.includes("mode: 'smoke'")) {
        fail(`verified package ${dir.name} runtime test lacks dry or smoke mode`)
      }
    }
    const fixture = existsSync(canonicalPath) ? readJson(canonicalPath) : { canonical: [], invalid: [] }
    if ((fixture.canonical ?? []).length === 0) fail(`verified package ${dir.name} has no canonical spec`)
    if ((fixture.invalid ?? []).length < 3) fail(`package ${dir.name} has fewer than 3 invalid specs`)
  }
}
if (packCount !== 13) fail(`expected 13 development pack packages, found ${packCount}`)
if (packMaturity.size !== 13) fail(`expected 13 built-in packs, found ${packMaturity.size}`)

// The core bundle is the only installable DSH plugin in this workspace.
if (corePkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('core must declare the DSH bundle patch')
if (corePkg.dsh?.client?.platform !== 'web' || corePkg.dsh?.client?.immediately !== true) {
  fail('core must declare dsh.client { platform: web, immediately: true }')
}
if (corePkg.exports?.['./client'] !== './lib/client.js') fail('core must export ./client')
for (const file of ['lib/client.js', 'src/packs/builtin/index.js', 'src/host/routes.js', 'src/state.js']) {
  if (!existsSync(join(root, 'packages', 'core', file))) fail(`core is missing ${file}`)
}
const corePatch = readFileSync(join(root, 'packages', 'core', 'cordis.patch.yml'), 'utf8')
const insertRows = [...corePatch.matchAll(/^\s*- id: (.+)$/gm)].map((match) => match[1].trim())
if (insertRows.join(',') !== 'dsh-revbayes-forge') {
  fail(`core cordis.patch.yml must insert exactly one bundle (found: ${insertRows.join(', ') || 'none'})`)
}

// The development meta package must not become a second bundle row.
const metaPkgPath = join(root, 'packages', 'meta-full', 'package.json')
if (existsSync(metaPkgPath)) {
  const metaPkg = readJson(metaPkgPath)
  if (metaPkg.dsh !== undefined) fail('meta-full must not declare DSH bundle metadata')
  if (existsSync(join(root, 'packages', 'meta-full', 'cordis.patch.yml'))) fail('meta-full must not keep a cordis.patch.yml')
  for (const [name, version] of Object.entries(metaPkg.dependencies ?? {})) {
    if (name !== 'dsh-revbayes-forge') fail(`meta-full must not depend on pack bundle ${name}@${version}`)
  }
}

// Optional: verify the committed index against the real reference tree.
const referenceRoot = resolve(argOf('--root') ?? process.env.REVBAYES_TUTORIALS ?? join(root, '..', 'dsh-revbayes-forge-参考项目', 'revbayes.github.io-source', 'tutorials'))
if (existsSync(referenceRoot) && statSync(referenceRoot).isDirectory()) {
  let actualTotal = 0
  for (const [tutorial, value] of Object.entries(index.tutorials)) {
    const dir = join(referenceRoot, tutorial)
    if (!existsSync(dir)) {
      fail(`tutorial directory ${tutorial} is missing from the reference tree`)
      continue
    }
    const actual = countRevFiles(dir)
    const expected = typeof value === 'number' ? value : value.count
    actualTotal += actual
    if (actual !== expected) fail(`tutorial ${tutorial}: index says ${expected}, reference has ${actual}`)
  }
  if (actualTotal !== EXPECTED_SCRIPTS) fail(`reference tree has ${actualTotal} tutorial scripts, expected ${EXPECTED_SCRIPTS}`)
}

// Full official-corpus accounting: every tutorial directory published on the
// official site is either owned by an analysis family or excluded with a
// documented reason (coverage/reference-corpus.yaml).
const corpusPath = join(root, 'coverage', 'reference-corpus.yaml')
if (!existsSync(corpusPath)) {
  fail('coverage/reference-corpus.yaml is missing')
} else {
  const corpus = readYaml(corpusPath)
  const entries = corpus.entries ?? []
  if (corpus.tutorial_directories !== entries.length) {
    fail('reference corpus declares tutorial_directories inconsistent with its entries')
  }
  const registered = new Set()
  for (const entry of entries) {
    if (registered.has(entry.dir)) fail(`reference corpus lists ${entry.dir} twice`)
    registered.add(entry.dir)
    if (entry.status === 'covered') {
      if (entry.family !== undefined) {
        if (!ids.has(entry.family)) fail(`corpus entry ${entry.dir} references unknown family ${entry.family}`)
        if (mappedTutorials.has(entry.dir) && mappedTutorials.get(entry.dir) !== entry.family) {
          fail(`corpus entry ${entry.dir} claims family ${entry.family} but families.yaml maps it to ${mappedTutorials.get(entry.dir)}`)
        }
      } else if (!mappedTutorials.has(entry.dir)) {
        fail(`corpus entry ${entry.dir} is covered but mapped to no family`)
      }
    } else if (entry.status === 'excluded') {
      if (!entry.reason || String(entry.reason).trim() === '') fail(`corpus entry ${entry.dir} is excluded without a reason`)
    } else {
      fail(`corpus entry ${entry.dir} has invalid status ${entry.status}`)
    }
  }
  for (const tutorial of mappedTutorials.keys()) {
    if (!registered.has(tutorial)) fail(`tutorial ${tutorial} is missing from the reference corpus register`)
  }
  if (existsSync(referenceRoot) && statSync(referenceRoot).isDirectory()) {
    for (const entry of readdirSync(referenceRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !registered.has(entry.name)) {
        fail(`reference tutorial directory ${entry.name} is not registered in coverage/reference-corpus.yaml`)
      }
    }
    for (const dir of registered) {
      if (!existsSync(join(referenceRoot, dir))) fail(`corpus register lists ${dir}, absent from the reference tree`)
    }
  }
}

const byTutorial = Object.entries(index.tutorials).map(([tutorial, value]) => `${tutorial} (${typeof value === 'number' ? value : value.count})`).join(', ')
console.log(`families: ${families.length}/${EXPECTED_FAMILIES}`)
console.log(`tutorial scripts: ${scriptTotal}/${EXPECTED_SCRIPTS} across ${Object.keys(index.tutorials).length} directories`)
console.log(`packs scanned: ${packMaturity.size}`)
console.log(`mapped tutorials: ${byTutorial}`)
if (failures.length > 0) {
  console.error('\ncoverage gate failures:')
  for (const message of failures) console.error(`- ${message}`)
  if (checkMode) process.exit(1)
} else {
  console.log('\ncoverage gate passed')
}
