import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import manifest from '../src/manifest.js'
import { packContractTests } from 'dsh-revbayes-forge/testing'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'canonical.json'), 'utf8'))

packContractTests(manifest, {
  ...fixture,
  goldenDir: join(here, '..', 'fixtures', 'golden'),
})
