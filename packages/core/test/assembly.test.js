import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog } from '../src/rev/catalog.js'
import { createAssembly, makeBlock, sectionBlock } from '../src/assembly.js'
import { validateScript } from '../src/rev/static-validator.js'

const catalog = loadCatalog()

test('assembly sorts sections, renders blocks, and strictly validates the result', () => {
  const assembly = createAssembly({ catalog })
  assembly.add(sectionBlock({ id: 'late', title: 'Analysis', order: 900, lines: ['q()'] }))
  assembly.add(sectionBlock({ id: 'early', title: 'Reading in the Data', order: 100, lines: ['data <- readDiscreteCharacterData("data/dna.nex")', 'moves = VectorMoves()', 'monitors = VectorMonitors()'] }))
  assembly.add(sectionBlock({ id: 'model', title: 'Model', order: 200, lines: ['Q <- fnJC(4)', 'seq ~ dnPhyloCTMC(tree=readTrees("data/tree.tre")[1], Q=Q, type="DNA")', 'seq.clamp(data)'] }))
  const result = assembly.finish()
  assert.ok(result.sections[0].name.includes('Reading'))
  assert.ok(result.sections[2].name.includes('Analysis'))
  assert.equal(result.validation.summary.error, 0)
  assert.equal(result.stats.blocks, 3)
})

test('assembly rejects a block whose capability was not provided', () => {
  const assembly = createAssembly({ catalog })
  const block = makeBlock({
    id: 'needs.data',
    requires: ['data.character'],
    build: () => ({ section: { title: 'Needs data' }, lines: ['x <- 1'] }),
  })
  assert.throws(() => assembly.add(block), /requires capability/)
  assembly.add(sectionBlock({ id: 'data', title: 'Data', lines: ['x <- 1'], provides: ['data.character'] }))
  assert.doesNotThrow(() => assembly.add(block))
  assert.equal(assembly.has('data.character'), true)
})

test('assembly rejects duplicate variables across blocks', () => {
  const assembly = createAssembly({ catalog })
  assembly.add(sectionBlock({ id: 'one', title: 'One', lines: ['x <- 1'], variables: [{ name: 'x', kind: 'variable' }] }))
  assert.throws(() => assembly.add(sectionBlock({ id: 'two', title: 'Two', lines: ['x <- 2'], variables: [{ name: 'x', kind: 'variable' }] })), /duplicate variable/)
})

test('block validate diagnostics flow into the assembly result', () => {
  const assembly = createAssembly({ catalog })
  const block = makeBlock({
    id: 'warn-block',
    build: () => ({ section: { title: 'Warn' }, lines: ['x <- 1'] }),
    validate: () => [{ severity: 'error', code: 'RB4999', message: 'block invariant failed', source: 'block:warn-block' }],
  })
  assembly.add(block)
  const result = assembly.finish()
  assert.ok(result.diagnostics.some((item) => item.code === 'RB4999'))
})

test('assembly output itself passes the strict static validator', () => {
  const assembly = createAssembly({ catalog })
  assembly.add(sectionBlock({
    id: 'valid',
    title: 'Valid',
    lines: ['moves = VectorMoves()', 'monitors = VectorMonitors()', 'Q <- fnJC(4)', 'mymodel = model(Q)', 'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)', 'mymcmc.run(generations=10)', 'q()'],
  }))
  const result = assembly.finish()
  assert.equal(validateScript(result.script, { catalog, strict: true }).summary.error, 0)
})
