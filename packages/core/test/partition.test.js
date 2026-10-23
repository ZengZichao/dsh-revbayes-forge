import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadCatalog } from '../src/rev/catalog.js'
import { generateScript } from '../src/rev/generator.js'
import { validateScript } from '../src/rev/static-validator.js'
import { normalizeConfig } from '../src/config.js'
import { createGenerateTool } from '../src/tools/generate.js'

const catalog = loadCatalog()
const gen = (spec) => generateScript(spec, { catalog })

test('partitioned analyses generate one CTMC and monitor per partition', () => {
  const result = gen({
    name: 'partitioned_demo',
    data: {
      partitions: [
        { name: 'cytb', file: 'data/cytb.nex', type: 'DNA', taxa: ['A', 'B', 'C', 'D'] },
        { name: 'coi', file: 'data/coi.nex', type: 'DNA', taxa: ['A', 'B', 'C', 'D'] },
      ],
    },
    substitution: { per_partition: { cytb: { model: 'GTR', gamma: { categories: 4 } }, coi: { model: 'HKY' } } },
    tree: { source: 'uniform' },
    mcmc: { generations: 5000 },
  })
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics.filter((diag) => diag.severity === 'error')))
  assert.equal((result.script.match(/seq_cytb ~ dnPhyloCTMC/g) ?? []).length, 1)
  assert.equal((result.script.match(/seq_coi ~ dnPhyloCTMC/g) ?? []).length, 1)
  assert.match(result.script, /Q_cytb := fnGTR/)
  assert.match(result.script, /Q_coi := fnHKY/)
  assert.match(result.script, /mnModel\(filename="partitioned_demo_cytb\.log"/)
  assert.equal(validateScript(result.script, { catalog, strict: true }).summary.error, 0)
})

test('partition validation rejects inconsistent taxa and unknown per-partition keys', () => {
  const badTaxa = gen({
    data: { partitions: [{ name: 'a', file: 'a.nex', taxa: ['A'] }, { name: 'b', file: 'b.nex', taxa: ['B'] }] },
    mcmc: {},
  })
  assert.equal(badTaxa.ok, false)
  assert.ok(badTaxa.diagnostics.some((diag) => diag.code === 'RB5048'))
  const badKey = gen({
    data: { partitions: [{ name: 'a', file: 'a.nex' }] },
    substitution: { per_partition: { missing: { model: 'JC' } } },
    mcmc: {},
  })
  assert.equal(badKey.ok, false)
  assert.ok(badKey.diagnostics.some((diag) => diag.code === 'RB5050'))
})

test('partition validation rejects duplicate names, missing files, and empty partition sets', () => {
  const duplicate = gen({ data: { partitions: [{ name: 'a', file: 'a.nex' }, { name: 'a', file: 'b.nex' }] }, mcmc: {} })
  assert.ok(duplicate.diagnostics.some((diag) => diag.code === 'RB5043'))
  const missingFile = gen({ data: { partitions: [{ name: 'a' }] }, mcmc: {} })
  assert.ok(missingFile.diagnostics.some((diag) => diag.code === 'RB5044'))
  const empty = gen({ data: { partitions: [] }, mcmc: {} })
  assert.ok(empty.diagnostics.some((diag) => diag.code === 'RB5040'))
})

test('partitioned fixed tree with no free parameters is rejected', () => {
  const result = gen({
    data: { partitions: [{ name: 'a', file: 'a.nex' }] },
    substitution: { per_partition: { a: { model: 'JC' } } },
    tree: { source: 'fixed', file: 'tree.tre', branch_lengths: 'fixed' },
    mcmc: {},
  })
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some((diag) => diag.code === 'RB5060'))
})

test('generate tool accepts partitioned specs without analysis or data.file', async () => {
  const tool = defineTool(createGenerateTool({ config: normalizeConfig({}), catalog }))
  const workspace = mkdtempSync(join(tmpdir(), 'forge-partition-'))
  try {
    const exec = { agent: { session: { header: { cwd: workspace } } }, signal: new AbortController().signal, callId: 'partition-tool' }
    const result = await tool.execute({
      spec: {
        name: 'partition_tool_demo',
        data: { partitions: [{ name: 'cytb', file: 'data/cytb.nex' }, { name: 'coi', file: 'data/coi.nex' }] },
        substitution: { per_partition: { cytb: { model: 'GTR', gamma: { categories: 4 } }, coi: { model: 'HKY' } } },
        tree: { source: 'uniform', outgroup: ['A'] },
        mcmc: { generations: 5000 },
      },
      output_path: 'scripts/partition.Rev',
    }, exec)
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics.filter((diag) => diag.severity === 'error')))
    assert.equal(result.written, true)
    assert.equal(existsSync(join(workspace, 'scripts', 'partition.Rev')), true)
    assert.match(result.script, /seq_cytb ~ dnPhyloCTMC/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
