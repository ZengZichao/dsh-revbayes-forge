#!/usr/bin/env node
/**
 * Isolated DSH profile installation smoke test.
 *
 * Creates a throwaway DSH_HOME, installs the file: workspaces through the DSH
 * CLI, checks the dumped profile contains exactly one RevBayes Forge bundle and no pack bundles, then
 * removes the temporary home. Existing user profiles are never touched.
 *
 * If the `dsh` CLI is unavailable the script reports SKIP and exits 0; release
 * gates should run this on a machine with DSH installed.
 */
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = 'forge-test'
const home = mkdtempSync(join(tmpdir(), 'revbayes-forge-dsh-'))
const env = { ...process.env, DSH_HOME: home }
const useNpx = process.env.DSH_NPX === '1'
const dshJs = process.env.DSH_JS ?? ''
const command = dshJs.length > 0 ? process.execPath : (useNpx ? (process.platform === 'win32' ? 'npx.cmd' : 'npx') : (process.env.DSH_BIN ?? 'dsh'))
const commandPrefix = dshJs.length > 0 ? [dshJs] : (useNpx ? ['--yes', '@deepseek-ai/dsh@0.2.1-rc.2'] : [])

function run(args, { allowFailure = false } = {}) {
  const result = spawnSync(command, [...commandPrefix, ...args], { cwd: root, env, encoding: 'utf8', timeout: 300000 })
  if (result.error !== undefined || (result.status !== 0 && !allowFailure)) {
    const detail = result.error?.message ?? result.stderr ?? result.stdout ?? ''
    throw new Error(`${command} ${args.join(' ')} failed (status ${result.status}): ${detail.trim()}`)
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

let skipped = false
try {
  try {
    run(['--version'])
  } catch {
    skipped = true
    console.log('SKIP: the `dsh` CLI is not installed on PATH; DSH install verification was not run.')
  }
  if (!skipped) {
    run(['--profile', profile, '--from-default-profile', 'web', '--dump-config'], { allowFailure: true })
    run(['plugin', '--profile', profile, 'add', `file:${join(root, 'packages/core')}`])
    const dump = run(['--profile', profile, '--dump-config'])
    if (!dump.includes('revbayes-forge')) throw new Error('profile dump is missing revbayes-forge')
    if (dump.includes('dsh-revbayes-forge-pack-')) throw new Error('profile dump still mounts pack bundles')
    const rows = [...dump.matchAll(/^\s*- id: (dsh-revbayes-forge[^\s]*)$/gm)].map((match) => match[1])
    if (rows.length !== 1 || rows[0] !== 'dsh-revbayes-forge') {
      throw new Error(`expected exactly one RevBayes Forge bundle row, found: ${rows.join(', ') || 'none'}`)
    }
    const installed = join(home, 'profiles', profile, 'node_modules', 'dsh-revbayes-forge')
    for (const file of ['lib/client.js', 'src/packs/builtin/index.js', 'cordis.patch.yml']) {
      if (!existsSync(join(installed, file))) throw new Error(`installed core bundle is missing ${file}`)
    }
    if (existsSync(join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-tools'))) {
      throw new Error('profile bundles a local @deepseek-ai/dsh-tools copy; it must come from the DSH host')
    }
    console.log(`DSH install verification passed: exactly one RevBayes Forge bundle mounted in profile "${profile}".`)
  }
} catch (error) {
  console.error(`DSH install verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  rmSync(home, { recursive: true, force: true })
  if (!skipped) console.log(`Cleaned temporary DSH_HOME ${home}`)
}
