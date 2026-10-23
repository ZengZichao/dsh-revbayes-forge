import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog } from '../src/rev/catalog.js'
import { generateScript } from '../src/rev/generator.js'

const catalog = loadCatalog()
const gen = (spec) => generateScript(spec, { catalog })

test('every DNA substitution model generates a strict-clean script', () => {
  for (const model of ['JC', 'F81', 'K80', 'HKY', 'GTR']) {
    const result = gen({
      analysis: 'dna',
      name: `dna_${model}`,
      data: { file: 'data.nex' },
      substitution: {
        model,
        ...(model === 'GTR' ? { exchangeabilities: 'estimated' } : {}),
        ...(['F81', 'HKY', 'GTR'].includes(model) ? { base_frequencies: 'estimated' } : {}),
        ...(['K80', 'HKY'].includes(model) ? { kappa: 'estimated' } : {}),
      },
      tree: { source: 'uniform' },
      mcmc: { generations: 5000 },
    })
    assert.equal(result.ok, true, `${model}: ${JSON.stringify(result.diagnostics.filter((d) => d.severity === 'error'))}`)
    assert.equal(result.validation.summary.error, 0)
    assert.match(result.script, /mymcmc = mcmc\(model=mymodel, monitors=monitors, moves=moves/)
  }
})

test('GTR + gamma + invariant sites emits one CTMC and both rate modifiers', () => {
  const result = gen({
    analysis: 'dna',
    data: { file: 'data.nex' },
    substitution: {
      model: 'GTR',
      base_frequencies: [0.3, 0.2, 0.2, 0.3],
      exchangeabilities: [1, 2, 1, 1, 2, 1],
      gamma: { shape: 'estimated', categories: 4 },
      invariant_sites: 'estimated',
    },
    tree: { source: 'uniform', outgroup: ['A', 'B'], prior: 'gamma', prior_arguments: [2, 20] },
    mcmc: { generations: 50000, nruns: 2, sample_every: 50, output_dir: 'output' },
  })
  assert.equal(result.ok, true)
  assert.equal((result.script.match(/seq ~ dnPhyloCTMC/g) ?? []).length, 1)
  assert.match(result.script, /siteRates=site_rates, pInv=p_inv/)
  assert.match(result.script, /fnDiscretizeGamma\(alpha, alpha, 4\)/)
  assert.match(result.script, /bl\[i\] ~ dnGamma\(2, 20\)/)
  assert.match(result.script, /nruns=2, combine="mixed"/)
  assert.match(result.script, /filename="output\/dna_gtr\.log"/)
})

test('fixed simplex parameters are wrapped in simplex() for RevBayes type checking', () => {
  const result = gen({
    analysis: 'dna',
    data: { file: 'data.nex' },
    substitution: {
      model: 'GTR',
      base_frequencies: [0.3, 0.2, 0.2, 0.3],
      exchangeabilities: [1, 2, 1, 1, 2, 1],
    },
    tree: { source: 'uniform' },
    mcmc: {},
  })
  assert.equal(result.ok, true)
  assert.match(result.script, /pi <- simplex\(v\(0\.3,0\.2,0\.2,0\.3\)\)/)
  assert.match(result.script, /er <- simplex\(v\(1,2,1,1,2,1\)\)/)
})

test('fixed tree with fixed branch lengths does not assemble a second tree', () => {
  const result = gen({
    analysis: 'dna',
    data: { file: 'data.nex' },
    substitution: { model: 'HKY', kappa: 'estimated' },
    tree: { source: 'fixed', file: 'tree.tre', branch_lengths: 'fixed' },
    mcmc: {},
  })
  assert.equal(result.ok, true)
  assert.match(result.script, /psi <- readTrees\(tree_file, treetype="non-clock"\)\[1\]/)
  assert.doesNotMatch(result.script, /fnTreeAssembly/)
  assert.doesNotMatch(result.script, /moves\.append\( mvNNI/)
})

test('fixed tree with estimated branch lengths assembles branch lengths', () => {
  const result = gen({
    analysis: 'dna',
    data: { file: 'data.nex' },
    substitution: { model: 'HKY', kappa: 2.0 },
    tree: { source: 'fixed', file: 'tree.tre', branch_lengths: 'estimated', prior: 'lognormal', prior_arguments: [-2, 1] },
    mcmc: {},
  })
  assert.equal(result.ok, true)
  assert.match(result.script, /topology <- readTrees/)
  assert.match(result.script, /bl\[i\] ~ dnLognormal\(-2, 1\)/)
  assert.match(result.script, /psi := fnTreeAssembly\(topology, bl\)/)
})

test('morphology analysis uses the Mk/JC matrix and the observed state count', () => {
  const result = gen({
    analysis: 'morphology',
    data: { file: 'morph.nex', type: 'Standard', state_count: 3 },
    substitution: { gamma: { categories: 4 } },
    tree: { source: 'uniform' },
    mcmc: {},
  })
  assert.equal(result.ok, true)
  assert.match(result.script, /Q <- fnJC\(3\)/)
  assert.match(result.script, /type="Standard"/)
})

test('invalid specifications are rejected with actionable diagnostics', () => {
  const cases = [
    [{ analysis: 'dna', data: {} }, 'RB5008'],
    [{ analysis: 'morphology', data: { file: 'm.nex' }, substitution: { model: 'GTR' } }, 'RB5014'],
    [{ analysis: 'dna', data: { file: 'd.nex' }, tree: { source: 'uniform', branch_lengths: 'fixed' } }, 'RB5024'],
    [{ analysis: 'dna', data: { file: 'd.nex' }, substitution: { model: 'GTR', base_frequencies: [1, 2, 3, 4] } }, 'RB5006'],
    [{ analysis: 'dna', data: { file: 'd.nex' }, tree: { source: 'fixed' } }, 'RB5022'],
    [{ analysis: 'dna', data: { file: 'd.nex' }, substitution: { model: 'JC' }, tree: { source: 'fixed', file: 't.tre', branch_lengths: 'fixed' } }, 'RB5033'],
  ]
  for (const [spec, code] of cases) {
    const result = gen(spec)
    assert.equal(result.ok, false)
    assert.ok(result.diagnostics.some((d) => d.code === code), `expected ${code}, got ${JSON.stringify(result.diagnostics)}`)
  }
})

test('generation is deterministic apart from the date line', () => {
  const spec = { analysis: 'dna', data: { file: 'd.nex' }, substitution: { model: 'JC' }, tree: { source: 'uniform' }, mcmc: {} }
  const a = gen(spec).script.split('\n').filter((l) => !l.includes('Generated by'))
  const b = gen(spec).script.split('\n').filter((l) => !l.includes('Generated by'))
  assert.deepEqual(a, b)
})
