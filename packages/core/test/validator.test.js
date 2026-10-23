import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog } from '../src/rev/catalog.js'
import { applyFixes, validateScript } from '../src/rev/static-validator.js'
import { parse } from '../src/rev/parser.js'

const catalog = loadCatalog()
const validate = (source, options = {}) => validateScript(source, { catalog, ...options })

const canonical = `################################################################################
# Canonical JC analysis
################################################################################

data <- readDiscreteCharacterData("data/primates.nex")
taxa <- data.taxa()
num_taxa <- data.ntaxa()
num_branches <- 2 * num_taxa - 3

moves    = VectorMoves()
monitors = VectorMonitors()

Q <- fnJC(4)

out_group = clade("Galeopterus_variegatus")
topology ~ dnUniformTopology(taxa, outgroup=out_group)
moves.append( mvNNI(topology, weight=num_taxa/2.0) )
moves.append( mvSPR(topology, weight=num_taxa/10.0) )

for (i in 1:num_branches) {
    bl[i] ~ dnExponential(10.0)
    moves.append( mvScale(bl[i]) )
}

psi := fnTreeAssembly(topology, bl)
seq ~ dnPhyloCTMC(tree=psi, Q=Q, type="DNA")
seq.clamp(data)

mymodel = model(psi)
monitors.append( mnModel(filename="output/primates.log", printgen=10) )
monitors.append( mnFile(filename="output/primates.trees", printgen=10, psi) )
monitors.append( mnScreen(printgen=100) )

mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)
mymcmc.run(generations=20000)
q()
`

test('canonical analysis validates without errors', () => {
  const result = validate(canonical)
  assert.equal(result.summary.error, 0)
  assert.equal(result.ok, true)
  assert.ok(result.stats.calls > 20)
})

test('parser supports pipeline, typed functions, compound assignments, and matrix indices', () => {
  const source = `function RealPos square(Real x) { x * x }
n <- 0
for (i in 1:4) n += i
M := Q |> fnGammaASRV(alpha, 4)
x = mat[,1]
moves[mi++] = mvScale(kappa)
`
  const parsed = parse(source)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.program.body[0].type, 'functionDeclaration')
})

test('unknown function is a warning by default and an error in strict mode', () => {
  const source = 'Q <- dnJC(4)\n'
  const soft = validate(source)
  assert.equal(soft.ok, true)
  const warning = soft.diagnostics.find((d) => d.code === 'RB2101')
  assert.equal(warning.severity, 'warning')
  assert.match(warning.suggestion, /fnJC/)
  assert.equal(warning.fix.text, 'fnJC')
  const strict = validate(source, { strict: true })
  assert.equal(strict.ok, false)
})

test('mcmc.run typo gets an error and a safe fix', () => {
  const source = canonical.replace('mymcmc.run(generations=20000)', 'mymcmc.run(generation=20000)')
  const result = validate(source)
  const diagnostic = result.diagnostics.find((d) => d.code === 'RB3102')
  assert.equal(diagnostic.severity, 'error')
  assert.match(diagnostic.message, /generation/)
  assert.match(diagnostic.suggestion, /generations/)
  const fixed = applyFixes(source, result.diagnostics)
  assert.equal(fixed.applied.length, 1)
  assert.match(fixed.script, /mymcmc\.run\(generations=20000\)/)
})

test('invalid enum values are reported with suggestions', () => {
  const source = canonical.replace('type="DNA"', 'type="DNAS"')
  const result = validate(source)
  const diagnostic = result.diagnostics.find((d) => d.code === 'RB3202')
  assert.equal(diagnostic.severity, 'error')
  assert.match(diagnostic.suggestion, /"DNA"/)
})

test('structural errors are reported with positions', () => {
  const result = validate('x <- "unterminated\n')
  const error = result.diagnostics.find((d) => d.code === 'RB1002')
  assert.equal(error.severity, 'error')
  assert.equal(error.line, 1)
})

test('undefined variables are warnings, not hard errors', () => {
  const source = 'x <- y + 1\n'
  const result = validate(source)
  assert.equal(result.ok, true)
  assert.ok(result.diagnostics.some((d) => d.code === 'RB2103' && d.message.includes("'y'")))
})

test('mcmc positional moves/monitors order is flagged with a review fix', () => {
  const source = canonical.replace(
    'mymcmc = mcmc(model=mymodel, monitors=monitors, moves=moves)',
    'mymcmc = mcmc(mymodel, moves, monitors)',
  )
  const result = validate(source)
  const diagnostic = result.diagnostics.find((d) => d.code === 'RB4105')
  assert.ok(diagnostic)
  assert.equal(diagnostic.fix.safety, 'review')
  const fixed = applyFixes(source, result.diagnostics)
  assert.equal(fixed.applied.length, 0)
  const risky = applyFixes(source, result.diagnostics, { risky: true })
  assert.equal(risky.applied.length, 1)
  assert.match(risky.script, /mcmc\(mymodel, monitors=monitors, moves=moves\)/)
})

test('missing data clamp and no moves are detected', () => {
  const source = canonical.replace('seq.clamp(data)', '').replaceAll('moves.append(', '# moves.append(')
  const result = validate(source)
  assert.ok(result.diagnostics.some((d) => d.code === 'RB4102'))
  assert.ok(result.diagnostics.some((d) => d.code === 'RB4101'))
})
