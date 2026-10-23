/**
 * RevBayes script generator.
 *
 * The section layout and analysis vocabulary follow RevScripter (DNA models,
 * JC/F81/K80/HKY/GTR, +I/+G, uniform topology, branch-length priors, MCMC
 * settings), while the emitted Rev code follows the current RevBayes tutorials:
 * named MCMC arguments, one CTMC declaration, correct fixed-tree handling, and
 * `fnTreeAssembly` only when branch lengths are estimated.
 */
import { validateScript } from './static-validator.js'

export const GENERATOR_VERSION = '0.1.0'
const DNA_MODELS = new Set(['JC', 'F81', 'K80', 'HKY', 'GTR'])
const PRIOR_DISTRIBUTIONS = new Set(['exponential', 'gamma', 'lognormal', 'uniform'])
const DATA_TYPES = new Set(['DNA', 'RNA', 'Standard', 'Binary'])

class SpecError extends Error {
  constructor(code, message, path = null, suggestion = null) {
    super(message)
    this.code = code
    this.path = path
    this.suggestion = suggestion
  }
}

function sectionTag(title) {
  const inner = `# ${title} #`
  return ['#'.repeat(title.length + 4), inner, '#'.repeat(title.length + 4)].join('\n')
}

function sanitizeName(value) {
  return String(value).trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'revbayes_analysis'
}

function asPositiveInteger(value, fallback, path, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SpecError('RB5001', `${path} must be an integer between ${min} and ${max}, but got ${JSON.stringify(value)}.`, path)
  }
  return value
}

function asPositiveNumber(value, fallback, path) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new SpecError('RB5002', `${path} must be a positive number, but got ${JSON.stringify(value)}.`, path)
  }
  return value
}

function asProbability(value, fallback, path) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new SpecError('RB5003', `${path} must be a number in [0, 1), but got ${JSON.stringify(value)}.`, path)
  }
  return value
}

function fixedSimplex(value, length, path) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new SpecError('RB5004', `${path} must be an array of ${length} positive numbers.`, path)
  }
  const numbers = value.map((item) => Number(item))
  if (numbers.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new SpecError('RB5005', `${path} must contain only positive numbers.`, path)
  }
  const sum = numbers.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 1e-6) {
    throw new SpecError('RB5006', `${path} must sum to 1 (got ${sum}).`, path, 'Normalize the values, e.g. divide each by their sum.')
  }
  return numbers
}

function vLiteral(values) {
  return `v(${values.map((n) => String(n)).join(',')})`
}

function priorCall(prior, args) {
  switch (prior) {
    case 'exponential':
      return `dnExponential(${args[0]})`
    case 'gamma':
      return `dnGamma(${args[0]}, ${args[1]})`
    case 'lognormal':
      return `dnLognormal(${args[0]}, ${args[1]})`
    case 'uniform':
      return `dnUniform(${args[0]}, ${args[1]})`
    default:
      return `dnExponential(${args[0]})`
  }
}

function normalizeSpec(spec, diagnostics) {
  const warnings = []
  const error = (code, message, path, suggestion = null) => {
    diagnostics.push({ severity: 'error', code, message, path, source: 'generator', ...(suggestion === null ? {} : { suggestion }) })
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new SpecError('RB5000', 'The analysis specification must be an object.')
  }
  const analysis = String(spec.analysis ?? '').toLowerCase()
  if (!['dna', 'morphology'].includes(analysis)) {
    throw new SpecError('RB5007', `analysis must be "dna" or "morphology", but got ${JSON.stringify(spec.analysis)}.`)
  }
  const data = spec.data ?? {}
  const fileName = typeof data.file === 'string' ? data.file.trim() : ''
  if (fileName.length === 0) throw new SpecError('RB5008', 'data.file is required and must be a non-empty string.')

  const defaultType = analysis === 'dna' ? 'DNA' : 'Standard'
  const dataType = data.type === undefined ? defaultType : String(data.type)
  if (!DATA_TYPES.has(dataType)) {
    throw new SpecError('RB5009', `data.type must be one of ${[...DATA_TYPES].join(', ')}, but got ${JSON.stringify(data.type)}.`)
  }
  if (analysis === 'dna' && dataType !== 'DNA' && dataType !== 'RNA') {
    throw new SpecError('RB5010', `data.type "${dataType}" is not valid for a DNA/RNA analysis.`)
  }
  if (analysis === 'morphology' && !['Standard', 'Binary'].includes(dataType)) {
    throw new SpecError('RB5011', `data.type "${dataType}" is not valid for a morphology analysis (use Standard or Binary).`)
  }
  const defaultStates = analysis === 'dna' ? 4 : (dataType === 'Binary' ? 2 : 2)
  const stateCount = asPositiveInteger(data.state_count, defaultStates, 'data.state_count', { min: 2, max: 64 })
  if (analysis === 'dna' && stateCount !== 4) {
    throw new SpecError('RB5012', 'DNA and RNA analyses require data.state_count = 4.')
  }

  const substitution = spec.substitution ?? {}
  const model = String(substitution.model ?? 'JC').toUpperCase()
  if (!DNA_MODELS.has(model)) {
    throw new SpecError('RB5013', `substitution.model must be one of ${[...DNA_MODELS].join(', ')}, but got ${JSON.stringify(substitution.model)}.`)
  }
  if (analysis === 'morphology' && model !== 'JC') {
    throw new SpecError('RB5014', 'Morphology generation supports only the Mk/JC model (a Jukes-Cantor matrix with the observed state count).')
  }

  const baseFrequencies = substitution.base_frequencies
  let pi = null
  if (['F81', 'HKY', 'GTR'].includes(model)) {
    if (baseFrequencies === 'estimated' || baseFrequencies === undefined) pi = { mode: 'estimated' }
    else if (Array.isArray(baseFrequencies)) pi = { mode: 'fixed', values: fixedSimplex(baseFrequencies, stateCount, 'substitution.base_frequencies') }
    else throw new SpecError('RB5015', 'substitution.base_frequencies must be "estimated" or an array of four positive numbers.')
  }

  let kappa = null
  if (['K80', 'HKY'].includes(model)) {
    if (substitution.kappa === 'estimated' || substitution.kappa === undefined) kappa = { mode: 'estimated' }
    else {
      const value = asPositiveNumber(substitution.kappa, null, 'substitution.kappa')
      if (value === null) throw new SpecError('RB5016', 'substitution.kappa must be a positive number or "estimated".')
      kappa = { mode: 'fixed', value }
    }
  }

  let exchangeabilities = null
  if (model === 'GTR') {
    if (substitution.exchangeabilities === 'estimated' || substitution.exchangeabilities === undefined) exchangeabilities = { mode: 'estimated' }
    else {
      const values = substitution.exchangeabilities
      if (!Array.isArray(values) || values.length !== 6 || values.some((v) => !(Number(v) > 0))) {
        throw new SpecError('RB5017', 'substitution.exchangeabilities must be "estimated" or an array of six positive numbers.')
      }
      exchangeabilities = { mode: 'fixed', values: values.map(Number) }
    }
  }

  let pInv = null
  if (substitution.invariant_sites !== undefined && substitution.invariant_sites !== null && substitution.invariant_sites !== false) {
    if (substitution.invariant_sites === 'estimated') pInv = { mode: 'estimated' }
    else pInv = { mode: 'fixed', value: asProbability(substitution.invariant_sites, null, 'substitution.invariant_sites') }
    if (pInv.mode === 'fixed' && pInv.value === null) throw new SpecError('RB5018', 'substitution.invariant_sites must be a probability or "estimated".')
  }

  let gamma = null
  if (substitution.gamma !== undefined && substitution.gamma !== null && substitution.gamma !== false) {
    if (typeof substitution.gamma !== 'object' || Array.isArray(substitution.gamma)) {
      throw new SpecError('RB5019', 'substitution.gamma must be an object with shape/categories, or omitted.')
    }
    const shape = substitution.gamma.shape === 'estimated' || substitution.gamma.shape === undefined
      ? { mode: 'estimated' }
      : { mode: 'fixed', value: asPositiveNumber(substitution.gamma.shape, null, 'substitution.gamma.shape') }
    if (shape.mode === 'fixed' && shape.value === null) throw new SpecError('RB5020', 'substitution.gamma.shape must be positive or "estimated".')
    const categories = asPositiveInteger(substitution.gamma.categories, 4, 'substitution.gamma.categories', { min: 2, max: 20 })
    gamma = { shape, categories }
  }

  const tree = spec.tree ?? {}
  const treeSource = String(tree.source ?? 'uniform').toLowerCase()
  if (!['uniform', 'fixed'].includes(treeSource)) throw new SpecError('RB5021', 'tree.source must be "uniform" or "fixed".')
  const treeFile = typeof tree.file === 'string' ? tree.file.trim() : ''
  if (treeSource === 'fixed' && treeFile.length === 0) throw new SpecError('RB5022', 'tree.file is required when tree.source is "fixed".')
  let branchLengths = tree.branch_lengths
  if (branchLengths === undefined) branchLengths = treeSource === 'fixed' ? 'fixed' : 'estimated'
  if (!['estimated', 'fixed'].includes(branchLengths)) throw new SpecError('RB5023', 'tree.branch_lengths must be "estimated" or "fixed".')
  if (treeSource === 'uniform' && branchLengths === 'fixed') {
    throw new SpecError('RB5024', 'tree.branch_lengths="fixed" requires tree.source="fixed" (a uniform topology has no branch lengths to keep).')
  }
  const prior = String(tree.prior ?? 'exponential').toLowerCase()
  if (!PRIOR_DISTRIBUTIONS.has(prior)) throw new SpecError('RB5025', `tree.prior must be one of ${[...PRIOR_DISTRIBUTIONS].join(', ')}.`)
  const defaults = { exponential: [10.0], gamma: [2.0, 20.0], lognormal: [-2.0, 1.0], uniform: [0.0, 1.0] }
  const priorArguments = tree.prior_arguments === undefined ? defaults[prior] : tree.prior_arguments
  if (!Array.isArray(priorArguments) || priorArguments.length !== defaults[prior].length || priorArguments.some((v) => !Number.isFinite(Number(v)))) {
    throw new SpecError('RB5026', `tree.prior_arguments for ${prior} must be an array of ${defaults[prior].length} numbers.`)
  }
  if (branchLengths === 'estimated') {
    if (prior === 'exponential' && Number(priorArguments[0]) <= 0) throw new SpecError('RB5027', 'The exponential rate must be positive.')
    if (prior === 'gamma' && (Number(priorArguments[0]) <= 0 || Number(priorArguments[1]) <= 0)) {
      throw new SpecError('RB5028', 'Gamma shape and rate must be positive.')
    }
    if (prior === 'lognormal' && Number(priorArguments[1]) <= 0) {
      throw new SpecError('RB5028', 'The lognormal standard deviation (second argument) must be positive.')
    }
    if (prior === 'uniform' && (Number(priorArguments[0]) < 0 || Number(priorArguments[1]) <= Number(priorArguments[0]))) {
      throw new SpecError('RB5029', 'The uniform bounds must satisfy 0 <= min < max.')
    }
  }
  const outgroup = tree.outgroup === undefined ? null : tree.outgroup
  if (outgroup !== null && (!Array.isArray(outgroup) || outgroup.length === 0 || outgroup.some((t) => typeof t !== 'string' || t.trim().length === 0))) {
    throw new SpecError('RB5030', 'tree.outgroup must be a non-empty array of taxon names.')
  }
  if (treeSource === 'fixed' && outgroup !== null) warnings.push({ code: 'RB5101', message: 'tree.outgroup is ignored for a fixed tree.' })

  const mcmc = spec.mcmc ?? {}
  const generations = asPositiveInteger(mcmc.generations, 10000, 'mcmc.generations', { min: 1, max: 1e12 })
  const nruns = asPositiveInteger(mcmc.nruns, 1, 'mcmc.nruns', { min: 1, max: 16 })
  if (nruns > 4) warnings.push({ code: 'RB5102', message: `nruns=${nruns}: running more than four chains can be expensive.` })
  const sampleEvery = asPositiveInteger(mcmc.sample_every, 10, 'mcmc.sample_every', { min: 1, max: 1e9 })
  if (sampleEvery > generations) warnings.push({ code: 'RB5103', message: `mcmc.sample_every (${sampleEvery}) exceeds generations (${generations}); at most one sample will be written.` })
  const screenEvery = asPositiveInteger(mcmc.screen_every, 100, 'mcmc.screen_every', { min: 1, max: 1e9 })
  const tuningInterval = asPositiveInteger(mcmc.tuning_interval, Math.min(100, generations), 'mcmc.tuning_interval', { min: 1, max: 1e9 })
  const moveschedule = mcmc.moveschedule === undefined ? 'random' : String(mcmc.moveschedule)
  if (!['random', 'sequential', 'single'].includes(moveschedule)) throw new SpecError('RB5031', 'mcmc.moveschedule must be random, sequential, or single.')
  const combine = mcmc.combine === undefined ? 'mixed' : String(mcmc.combine)
  if (!['sequential', 'mixed', 'none'].includes(combine)) throw new SpecError('RB5032', 'mcmc.combine must be sequential, mixed, or none.')
  const rawName = spec.name ?? `${analysis}_${model.toLowerCase()}`
  const name = sanitizeName(rawName)
  if (name !== String(rawName)) warnings.push({ code: 'RB5104', message: `name was sanitized from ${JSON.stringify(rawName)} to ${JSON.stringify(name)}.` })
  const outputDirRaw = mcmc.output_dir === undefined ? '' : String(mcmc.output_dir).trim().replace(/^\/+|\/+$/g, '')
  const outputDir = outputDirRaw
  const prefix = `${outputDir.length > 0 ? `${outputDir}/` : ''}${name}`
  const script = spec.script ?? {}
  const includeHeader = script.header !== false

  // An MCMC needs at least one move. A fixed tree with fixed branch lengths and
  // a fully fixed substitution/rate model has nothing to estimate; reject it
  // instead of emitting a chain that cannot sample.
  const freeParameters = treeSource === 'uniform'
    || branchLengths === 'estimated'
    || pi?.mode === 'estimated'
    || kappa?.mode === 'estimated'
    || exchangeabilities?.mode === 'estimated'
    || gamma?.shape?.mode === 'estimated'
    || pInv?.mode === 'estimated'
  if (!freeParameters) {
    throw new SpecError('RB5033', 'This specification has no free parameters, so the MCMC would have no moves. Estimate the tree, branch lengths, or a substitution/rate parameter, or run a fixed-tree likelihood analysis instead.')
  }

  return {
    analysis, dataType, stateCount, fileName,
    substitution: { model, pi, kappa, exchangeabilities, pInv, gamma },
    tree: { source: treeSource, file: treeFile, branchLengths, prior, priorArguments: priorArguments.map(Number), outgroup },
    mcmc: { generations, nruns, sampleEvery, screenEvery, tuningInterval, moveschedule, combine, outputDir, prefix },
    name, includeHeader, warnings,
  }
}

/**
 * Generate a partitioned analysis from `data.partitions` plus
 * `substitution.per_partition` overrides. This is a core capability, not a
 * model pack: it reads each alignment separately, shares one tree, and emits a
 * CTMC/monitor per partition.
 */
function generatePartitionedScript(spec, options = {}) {
  const diagnostics = []
  const fail = (code, message, path, suggestion = null) => {
    throw new SpecError(code, message, path, suggestion)
  }
  try {
    const partitions = spec.data.partitions
    if (partitions.length === 0) fail('RB5040', 'data.partitions must contain at least one partition.', 'data.partitions')
    const names = new Set()
    const normalizedPartitions = partitions.map((partition, index) => {
      if (partition === null || typeof partition !== 'object' || Array.isArray(partition)) {
        fail('RB5041', `data.partitions[${index}] must be an object.`, `data.partitions[${index}]`)
      }
      const rawName = String(partition.name ?? `partition_${index + 1}`)
      const name = sanitizeName(rawName)
      if (name !== rawName) fail('RB5042', `data.partitions[${index}].name must be a valid identifier.`, `data.partitions[${index}].name`)
      if (names.has(name)) fail('RB5043', `duplicate partition name "${name}".`, `data.partitions[${index}].name`)
      names.add(name)
      const file = typeof partition.file === 'string' ? partition.file.trim() : ''
      if (file.length === 0) fail('RB5044', `data.partitions[${index}].file is required.`, `data.partitions[${index}].file`)
      const type = partition.type === undefined ? 'DNA' : String(partition.type)
      if (!DATA_TYPES.has(type)) fail('RB5045', `data.partitions[${index}].type must be one of ${[...DATA_TYPES].join(', ')}.`, `data.partitions[${index}].type`)
      const stateCount = asPositiveInteger(partition.state_count, type === 'DNA' || type === 'RNA' ? 4 : 2, `data.partitions[${index}].state_count`, { min: 2, max: 64 })
      if ((type === 'DNA' || type === 'RNA') && stateCount !== 4) fail('RB5046', `data.partitions[${index}] requires state_count = 4 for ${type}.`, `data.partitions[${index}].state_count`)
      if (Array.isArray(partition.taxa) && partition.taxa.some((taxon) => typeof taxon !== 'string' || taxon.trim().length === 0)) {
        fail('RB5047', `data.partitions[${index}].taxa must contain non-empty strings.`, `data.partitions[${index}].taxa`)
      }
      return { name, file, type, stateCount, taxa: Array.isArray(partition.taxa) ? [...partition.taxa].sort() : null }
    })
    const firstTaxa = normalizedPartitions.find((partition) => partition.taxa !== null)?.taxa ?? null
    if (firstTaxa !== null) {
      for (const partition of normalizedPartitions) {
        if (partition.taxa !== null && partition.taxa.join('\u0000') !== firstTaxa.join('\u0000')) {
          fail('RB5048', `partition "${partition.name}" has a different taxon set; all partitions must share taxa.`, `data.partitions.${partition.name}.taxa`)
        }
      }
    }
    const perPartition = spec.substitution?.per_partition ?? {}
    if (perPartition !== null && (typeof perPartition !== 'object' || Array.isArray(perPartition))) {
      fail('RB5049', 'substitution.per_partition must be an object keyed by partition name.', 'substitution.per_partition')
    }
    for (const key of Object.keys(perPartition)) {
      if (!names.has(key)) fail('RB5050', `substitution.per_partition refers to unknown partition "${key}".`, `substitution.per_partition.${key}`)
    }
    const defaults = { model: spec.substitution?.model ?? 'JC', gamma: spec.substitution?.gamma ?? null, invariant_sites: spec.substitution?.invariant_sites ?? null }
    const models = normalizedPartitions.map((partition) => {
      const override = perPartition[partition.name] ?? {}
      const model = String(override.model ?? defaults.model).toUpperCase()
      if (!DNA_MODELS.has(model)) fail('RB5051', `substitution.model for partition ${partition.name} must be one of ${[...DNA_MODELS].join(', ')}.`, `substitution.per_partition.${partition.name}.model`)
      let pi = null
      if (['F81', 'HKY', 'GTR'].includes(model)) {
        const frequencies = override.base_frequencies ?? defaults.base_frequencies
        if (frequencies === 'estimated' || frequencies === undefined) pi = { mode: 'estimated' }
        else pi = { mode: 'fixed', values: fixedSimplex(frequencies, partition.stateCount, `substitution.per_partition.${partition.name}.base_frequencies`) }
      }
      let kappa = null
      if (['K80', 'HKY'].includes(model)) {
        const value = override.kappa ?? defaults.kappa
        if (value === 'estimated' || value === undefined) kappa = { mode: 'estimated' }
        else kappa = { mode: 'fixed', value: asPositiveNumber(value, null, `substitution.per_partition.${partition.name}.kappa`) }
      }
      let exchangeabilities = null
      if (model === 'GTR') {
        const values = override.exchangeabilities ?? defaults.exchangeabilities
        if (values === 'estimated' || values === undefined) exchangeabilities = { mode: 'estimated' }
        else {
          if (!Array.isArray(values) || values.length !== 6 || values.some((value) => !(Number(value) > 0))) {
            fail('RB5052', `substitution.exchangeabilities for partition ${partition.name} must be six positive numbers.`, `substitution.per_partition.${partition.name}.exchangeabilities`)
          }
          exchangeabilities = { mode: 'fixed', values: values.map(Number) }
        }
      }
      let gamma = null
      const gammaRaw = override.gamma === undefined ? defaults.gamma : override.gamma
      if (gammaRaw !== null && gammaRaw !== undefined && gammaRaw !== false) {
        if (typeof gammaRaw !== 'object' || Array.isArray(gammaRaw)) fail('RB5053', `gamma for partition ${partition.name} must be an object.`, `substitution.per_partition.${partition.name}.gamma`)
        const shape = gammaRaw.shape === 'estimated' || gammaRaw.shape === undefined ? { mode: 'estimated' } : { mode: 'fixed', value: asPositiveNumber(gammaRaw.shape, null, `substitution.per_partition.${partition.name}.gamma.shape`) }
        gamma = { shape, categories: asPositiveInteger(gammaRaw.categories, 4, `substitution.per_partition.${partition.name}.gamma.categories`, { min: 2, max: 20 }) }
      }
      let pInv = null
      const invRaw = override.invariant_sites === undefined ? defaults.invariant_sites : override.invariant_sites
      if (invRaw !== undefined && invRaw !== null && invRaw !== false) {
        pInv = invRaw === 'estimated' ? { mode: 'estimated' } : { mode: 'fixed', value: asProbability(invRaw, null, `substitution.per_partition.${partition.name}.invariant_sites`) }
      }
      return { ...partition, model, pi, kappa, exchangeabilities, gamma, pInv }
    })

    const tree = spec.tree ?? {}
    const treeSource = String(tree.source ?? 'uniform').toLowerCase()
    if (!['uniform', 'fixed'].includes(treeSource)) fail('RB5054', 'tree.source must be "uniform" or "fixed".', 'tree.source')
    const treeFile = typeof tree.file === 'string' ? tree.file.trim() : ''
    if (treeSource === 'fixed' && treeFile.length === 0) fail('RB5055', 'tree.file is required when tree.source is "fixed".', 'tree.file')
    let branchLengths = tree.branch_lengths ?? (treeSource === 'fixed' ? 'fixed' : 'estimated')
    if (!['estimated', 'fixed'].includes(branchLengths)) fail('RB5056', 'tree.branch_lengths must be "estimated" or "fixed".', 'tree.branch_lengths')
    if (treeSource === 'uniform' && branchLengths === 'fixed') fail('RB5057', 'tree.branch_lengths="fixed" requires a fixed tree.', 'tree.branch_lengths')
    const prior = String(tree.prior ?? 'exponential').toLowerCase()
    if (!PRIOR_DISTRIBUTIONS.has(prior)) fail('RB5058', `tree.prior must be one of ${[...PRIOR_DISTRIBUTIONS].join(', ')}.`, 'tree.prior')
    const defaultsForPrior = { exponential: [10.0], gamma: [2.0, 20.0], lognormal: [-2.0, 1.0], uniform: [0.0, 1.0] }
    const priorArguments = (tree.prior_arguments ?? defaultsForPrior[prior]).map(Number)
    if (priorArguments.length !== defaultsForPrior[prior].length || priorArguments.some((value) => !Number.isFinite(value))) {
      fail('RB5059', `tree.prior_arguments for ${prior} must contain ${defaultsForPrior[prior].length} numbers.`, 'tree.prior_arguments')
    }
    const mcmc = spec.mcmc ?? {}
    const generations = asPositiveInteger(mcmc.generations, 10000, 'mcmc.generations', { min: 1, max: 1e12 })
    const sampleEvery = asPositiveInteger(mcmc.sample_every, 10, 'mcmc.sample_every', { min: 1, max: 1e9 })
    const screenEvery = asPositiveInteger(mcmc.screen_every, 100, 'mcmc.screen_every', { min: 1, max: 1e9 })
    const tuningInterval = asPositiveInteger(mcmc.tuning_interval, Math.min(100, generations), 'mcmc.tuning_interval', { min: 1, max: 1e9 })
    const nruns = asPositiveInteger(mcmc.nruns, 1, 'mcmc.nruns', { min: 1, max: 16 })
    const name = sanitizeName(spec.name ?? `partitioned_${models.map((model) => model.name).join('_')}`)
    const outputDir = String(mcmc.output_dir ?? '').trim().replace(/^[/\\]+|[/\\]+$/g, '')
    const prefix = `${outputDir.length > 0 ? `${outputDir}/` : ''}${name}`
    const freeParameters = treeSource === 'uniform' || branchLengths === 'estimated'
      || models.some((model) => model.pi?.mode === 'estimated' || model.kappa?.mode === 'estimated' || model.exchangeabilities?.mode === 'estimated' || model.gamma?.shape?.mode === 'estimated' || model.pInv?.mode === 'estimated')
    if (!freeParameters) fail('RB5060', 'The partitioned specification has no free parameters.', 'tree')

    const lines = []
    const sections = []
    const emit = (...text) => lines.push(...text)
    const startSection = (title) => {
      if (lines.length > 0) emit('')
      const startLine = lines.length + 1
      emit(sectionTag(title), '')
      sections.push({ name: title, startLine, endLine: null })
    }
    const endSection = () => { if (sections.length > 0) sections.at(-1).endLine = lines.length }
    if (spec.script?.header !== false) {
      emit(
        '################################################################################',
        `# ${name}`,
        `# Generated by dsh-revbayes-forge ${GENERATOR_VERSION}`,
        `# Analysis: partitioned (${models.length} partitions)`,
        `# Data: ${models.map((model) => model.file).join(', ')}`,
        '#',
        '# Review this script and the paths before running it. The data files must be',
        '# readable from the working directory in which RevBayes is started.',
        '################################################################################',
        '',
      )
    }
    startSection('Reading in the Partitioned Data')
    for (const model of models) emit(`data_${model.name} <- readDiscreteCharacterData(${JSON.stringify(model.file)})`)
    const first = models[0]
    emit(
      `taxa <- data_${first.name}.taxa()`,
      `num_taxa <- data_${first.name}.ntaxa()`,
      'num_branches <- 2 * num_taxa - 3',
      `num_partitions <- ${models.length}`,
      '',
      'moves    = VectorMoves()',
      'monitors = VectorMonitors()',
      '',
    )
    endSection()

    startSection('Partition Substitution Models')
    for (const model of models) {
      const tag = model.name
      if (model.model === 'JC') {
        emit(`Q_${tag} <- fnJC(${model.stateCount})`)
      } else {
        if (model.pi !== null) {
          if (model.pi.mode === 'fixed') emit(`pi_${tag} <- simplex(${vLiteral(model.pi.values)})`)
          else {
            emit(`pi_prior_${tag} <- ${vLiteral(Array.from({ length: model.stateCount }, () => 1))}`, `pi_${tag} ~ dnDirichlet(pi_prior_${tag})`)
            emit(`moves.append( mvBetaSimplex(pi_${tag}, weight=2) )`, `moves.append( mvDirichletSimplex(pi_${tag}, weight=1) )`)
          }
        }
        if (model.kappa !== null) {
          if (model.kappa.mode === 'fixed') emit(`kappa_${tag} <- ${model.kappa.value}`)
          else emit(`kappa_${tag} ~ dnLognormal(0.0, 1.0)`, `moves.append( mvScale(kappa_${tag}, weight=1) )`)
        }
        if (model.exchangeabilities !== null) {
          if (model.exchangeabilities.mode === 'fixed') emit(`er_${tag} <- simplex(${vLiteral(model.exchangeabilities.values)})`)
          else emit(`er_prior_${tag} <- ${vLiteral([1, 1, 1, 1, 1, 1])}`, `er_${tag} ~ dnDirichlet(er_prior_${tag})`, `moves.append( mvBetaSimplex(er_${tag}, weight=3) )`)
        }
        if (model.model === 'F81') emit(`Q_${tag} := fnF81(pi_${tag})`)
        else if (model.model === 'K80') emit(`Q_${tag} := fnK80(kappa_${tag})`)
        else if (model.model === 'HKY') emit(`Q_${tag} := fnHKY(kappa_${tag}, pi_${tag})`)
        else emit(`Q_${tag} := fnGTR(er_${tag}, pi_${tag})`)
      }
      if (model.gamma !== null) {
        if (model.gamma.shape.mode === 'fixed') emit(`alpha_${tag} <- ${model.gamma.shape.value}`)
        else emit(`alpha_${tag} ~ dnUniform(0.0, 10.0)`, `moves.append( mvScale(alpha_${tag}, weight=2) )`)
        emit(`site_rates_${tag} := fnDiscretizeGamma(alpha_${tag}, alpha_${tag}, ${model.gamma.categories})`)
      }
      if (model.pInv !== null) {
        if (model.pInv.mode === 'fixed') emit(`p_inv_${tag} <- ${model.pInv.value}`)
        else emit(`p_inv_${tag} ~ dnBeta(1.0, 1.0)`, `moves.append( mvSlide(p_inv_${tag}, weight=1) )`)
      }
      emit('')
    }
    endSection()

    startSection('Tree Model')
    if (treeSource === 'uniform') {
      emit('topology ~ dnUniformTopology(taxa)', 'moves.append( mvNNI(topology, weight=num_taxa/2.0) )', 'moves.append( mvSPR(topology, weight=num_taxa/10.0) )', '')
    } else {
      emit(`tree_file <- ${JSON.stringify(treeFile)}`, branchLengths === 'estimated' ? 'topology <- readTrees(tree_file, treetype="non-clock")[1]' : 'psi <- readTrees(tree_file, treetype="non-clock")[1]', '')
    }
    if (branchLengths === 'estimated') {
      emit('for (i in 1:num_branches) {', `    bl[i] ~ ${priorCall(prior, priorArguments)}`, '    moves.append( mvScale(bl[i], weight=1) )', '}', '', 'psi := fnTreeAssembly(topology, bl)', '')
    } else {
      emit('# Branch lengths are taken from the fixed tree.', '')
    }
    endSection()

    startSection('Partitioned PhyloCTMC Models')
    for (const model of models) {
      const args = ['tree=psi', `Q=Q_${model.name}`, `type=${JSON.stringify(model.type)}`]
      if (model.gamma !== null) args.push(`siteRates=site_rates_${model.name}`)
      if (model.pInv !== null) args.push(`pInv=p_inv_${model.name}`)
      emit(`seq_${model.name} ~ dnPhyloCTMC(${args.join(', ')})`, `seq_${model.name}.clamp(data_${model.name})`, '')
    }
    endSection()

    startSection('Analysis')
    emit(`mymodel = model(${models.map((model) => `seq_${model.name}`).join(', ')})`, '')
    if (outputDir.length === 0) emit('# NOTE: the monitors write to the current working directory.', '')
    else emit(`# NOTE: create the output directory before running, e.g. mkdir -p ${JSON.stringify(outputDir)}`, '')
    for (const model of models) {
      emit(`monitors.append( mnModel(filename=${JSON.stringify(`${prefix}_${model.name}.log`)}, printgen=${sampleEvery}) )`)
    }
    emit(
      `monitors.append( mnFile(filename=${JSON.stringify(`${prefix}.trees`)}, printgen=${sampleEvery}, psi) )`,
      `monitors.append( mnScreen(printgen=${screenEvery}) )`,
      '',
    )
    const mcmcArgs = ['model=mymodel', 'monitors=monitors', 'moves=moves', `moveschedule=${JSON.stringify(String(mcmc.moveschedule ?? 'random'))}`]
    if (nruns > 1) mcmcArgs.push(`nruns=${nruns}`, `combine=${JSON.stringify(String(mcmc.combine ?? 'mixed'))}`)
    emit(`mymcmc = mcmc(${mcmcArgs.join(', ')})`, `mymcmc.run(generations=${generations}, tuningInterval=${tuningInterval})`, 'mymcmc.operatorSummary()', '', '# Quit RevBayes after the analysis', 'q()', '')
    endSection()

    const script = lines.join('\n')
    let validation = null
    if (options.catalog !== undefined && options.catalog !== null) {
      validation = validateScript(script, { catalog: options.catalog, sourcePath: options.sourcePath ?? null, baseDir: options.baseDir ?? null, checkFiles: false, strict: true })
      diagnostics.push(...validation.diagnostics)
    }
    const ok = diagnostics.every((diagnostic) => diagnostic.severity !== 'error')
    return {
      ok,
      script,
      diagnostics,
      warnings: [],
      sections,
      name,
      spec: { partitions: normalizedPartitions.map((partition) => partition.name), tree: { source: treeSource }, mcmc: { generations } },
      validation,
      stats: { lines: script.split('\n').length, bytes: Buffer.byteLength(script, 'utf8'), monitors: models.length + 2, moves: countMoves(script), partitions: models.length },
    }
  } catch (error) {
    if (error instanceof SpecError) {
      diagnostics.push({
        severity: 'error', code: error.code, message: error.message, source: 'generator',
        ...(error.path === null ? {} : { path: error.path }),
        ...(error.suggestion === null ? {} : { suggestion: error.suggestion }),
      })
      return { ok: false, script: null, diagnostics, warnings: [], sections: [], name: null }
    }
    throw error
  }
}

/**
 * Generate a RevBayes script from a structured analysis specification.
 * @param {object} spec
 * @param {object} options
 * @param {object} options.catalog signature catalog for post-generation validation
 * @param {string} options.baseDir directory used to resolve relative data paths for warnings
 * @returns {object}
 */
export function generateScript(spec, options = {}) {
  if (spec !== null && typeof spec === 'object' && spec.data !== undefined && Array.isArray(spec.data?.partitions)) {
    return generatePartitionedScript(spec, options)
  }
  const diagnostics = []
  let normalized
  try {
    normalized = normalizeSpec(spec, diagnostics)
  } catch (error) {
    if (error instanceof SpecError) {
      diagnostics.push({
        severity: 'error', code: error.code, message: error.message, source: 'generator',
        ...(error.path === null ? {} : { path: error.path }),
        ...(error.suggestion === null ? {} : { suggestion: error.suggestion }),
      })
      return { ok: false, script: null, diagnostics, warnings: [], sections: [], name: null }
    }
    throw error
  }

  const warnings = normalized.warnings.map((w) => ({ ...w, severity: 'warning', source: 'generator' }))
  const n = normalized
  const lines = []
  const sections = []
  const emit = (...text) => { for (const item of text) lines.push(item) }
  const startSection = (title) => {
    if (lines.length > 0) emit('')
    const startLine = lines.length + 1
    emit(sectionTag(title), '')
    sections.push({ name: title, startLine, endLine: null })
  }
  const endSection = () => {
    if (sections.length > 0) sections.at(-1).endLine = lines.length
  }

  if (n.includeHeader) {
    emit(
      '################################################################################',
      `# ${n.name}`,
      `# Generated by dsh-revbayes-forge ${GENERATOR_VERSION}`,
      `# Analysis: ${n.analysis} / ${n.substitution.model}${n.substitution.gamma === null ? '' : ` +G${n.substitution.gamma.categories}`}${n.substitution.pInv === null ? '' : ' +I'}`,
      `# Data: ${n.fileName}`,
      '#',
      '# Review this script and the paths before running it. The data file must be',
      '# readable from the working directory in which RevBayes is started.',
      '################################################################################',
      '',
    )
  }

  startSection('Reading in the Data')
  emit(
    `data <- readDiscreteCharacterData(${JSON.stringify(n.fileName)})`,
    'taxa <- data.taxa()',
    'num_taxa <- data.ntaxa()',
    'num_branches <- 2 * num_taxa - 3',
    '',
    'moves    = VectorMoves()',
    'monitors = VectorMonitors()',
    '',
  )
  endSection()

  startSection('Substitution Model')
  const rateMatrix = n.analysis === 'dna' ? 4 : n.stateCount
  if (n.substitution.model === 'JC') {
    emit(`# Jukes-Cantor / Mk rate matrix with ${rateMatrix} states`, `Q <- fnJC(${rateMatrix})`, '')
  } else {
    emit(`# ${n.substitution.model} rate matrix`, '')
    if (n.substitution.pi !== null) {
      if (n.substitution.pi.mode === 'fixed') {
        emit(`pi <- simplex(${vLiteral(n.substitution.pi.values)})`)
      } else {
        emit(
          `pi_prior <- ${vLiteral(Array.from({ length: rateMatrix }, () => 1))}`,
          'pi ~ dnDirichlet(pi_prior)',
          'moves.append( mvBetaSimplex(pi, weight=2) )',
          'moves.append( mvDirichletSimplex(pi, weight=1) )',
        )
      }
    }
    if (n.substitution.kappa !== null) {
      if (n.substitution.kappa.mode === 'fixed') emit(`kappa <- ${n.substitution.kappa.value}`)
      else emit('kappa ~ dnLognormal(0.0, 1.0)', 'moves.append( mvScale(kappa, weight=1) )')
    }
    if (n.substitution.exchangeabilities !== null) {
      if (n.substitution.exchangeabilities.mode === 'fixed') {
        emit(`er <- simplex(${vLiteral(n.substitution.exchangeabilities.values)})`)
      } else {
        emit(
          `er_prior <- ${vLiteral([1, 1, 1, 1, 1, 1])}`,
          'er ~ dnDirichlet(er_prior)',
          'moves.append( mvBetaSimplex(er, weight=3) )',
          'moves.append( mvDirichletSimplex(er, weight=1) )',
        )
      }
    }
    emit('')
    if (n.substitution.model === 'F81') emit('Q := fnF81(pi)')
    else if (n.substitution.model === 'K80') emit('Q := fnK80(kappa)')
    else if (n.substitution.model === 'HKY') emit('Q := fnHKY(kappa, pi)')
    else if (n.substitution.model === 'GTR') emit('Q := fnGTR(er, pi)')
    emit('')
  }
  endSection()

  if (n.substitution.gamma !== null || n.substitution.pInv !== null) {
    startSection('Among-Site Rate Variation')
    if (n.substitution.gamma !== null) {
      if (n.substitution.gamma.shape.mode === 'fixed') emit(`alpha <- ${n.substitution.gamma.shape.value}`)
      else emit('alpha ~ dnUniform(0.0, 10.0)', 'moves.append( mvScale(alpha, weight=2) )')
      emit(
        `site_rates := fnDiscretizeGamma(alpha, alpha, ${n.substitution.gamma.categories})`,
        '',
      )
    }
    if (n.substitution.pInv !== null) {
      if (n.substitution.pInv.mode === 'fixed') emit(`p_inv <- ${n.substitution.pInv.value}`)
      else emit('p_inv ~ dnBeta(1.0, 1.0)', 'moves.append( mvSlide(p_inv, weight=1) )')
      emit('')
    }
    endSection()
  }

  startSection('Tree Model')
  if (n.tree.source === 'uniform') {
    if (n.tree.outgroup !== null) {
      const names = n.tree.outgroup.map((t) => JSON.stringify(t)).join(', ')
      emit(`out_group = clade(${names})`, 'topology ~ dnUniformTopology(taxa, outgroup=out_group)')
    } else {
      emit('topology ~ dnUniformTopology(taxa)')
    }
    emit(
      'moves.append( mvNNI(topology, weight=num_taxa/2.0) )',
      'moves.append( mvSPR(topology, weight=num_taxa/10.0) )',
      '',
    )
  } else {
    emit(`tree_file <- ${JSON.stringify(n.tree.file)}`)
    if (n.tree.branchLengths === 'estimated') {
      emit('topology <- readTrees(tree_file, treetype="non-clock")[1]', '')
    } else {
      emit('psi <- readTrees(tree_file, treetype="non-clock")[1]', '')
    }
  }

  if (n.tree.branchLengths === 'estimated') {
    const priorLine = priorCall(n.tree.prior, n.tree.priorArguments)
    emit(
      `# Branch lengths: iid ${n.tree.prior} priors`,
      'for (i in 1:num_branches) {',
      `    bl[i] ~ ${priorLine}`,
      '    moves.append( mvScale(bl[i], weight=1) )',
      '}',
      '',
      'psi := fnTreeAssembly(topology, bl)',
      '',
    )
  } else {
    // `psi` was assigned directly from the fixed tree above.
    emit('# Branch lengths are taken from the fixed tree.', '')
  }
  endSection()

  startSection('PhyloCTMC Model')
  const ctmcArgs = [`tree=psi`, 'Q=Q', `type=${JSON.stringify(n.dataType)}`]
  if (n.substitution.gamma !== null) ctmcArgs.push('siteRates=site_rates')
  if (n.substitution.pInv !== null) ctmcArgs.push('pInv=p_inv')
  emit(
    `seq ~ dnPhyloCTMC(${ctmcArgs.join(', ')})`,
    '',
    '# Attach the observed data to the CTMC node',
    'seq.clamp(data)',
    '',
  )
  endSection()

  startSection('Analysis')
  emit('mymodel = model(seq)', '')
  if (n.mcmc.outputDir.length === 0) {
    emit('# NOTE: the monitors write to the current working directory.', '')
  } else {
    emit(`# NOTE: create the output directory before running, e.g. mkdir -p ${JSON.stringify(n.mcmc.outputDir)}`, '')
  }
  emit(
    'monitors.append( mnModel(filename=' + JSON.stringify(`${n.mcmc.prefix}.log`) + `, printgen=${n.mcmc.sampleEvery}) )`,
    'monitors.append( mnFile(filename=' + JSON.stringify(`${n.mcmc.prefix}.trees`) + `, printgen=${n.mcmc.sampleEvery}, psi) )`,
    `monitors.append( mnScreen(printgen=${n.mcmc.screenEvery}) )`,
    '',
  )
  const mcmcArgs = ['model=mymodel', 'monitors=monitors', 'moves=moves', `moveschedule=${JSON.stringify(n.mcmc.moveschedule)}`]
  if (n.mcmc.nruns > 1) mcmcArgs.push(`nruns=${n.mcmc.nruns}`, `combine=${JSON.stringify(n.mcmc.combine)}`)
  emit(
    `mymcmc = mcmc(${mcmcArgs.join(', ')})`,
    `mymcmc.run(generations=${n.mcmc.generations}, tuningInterval=${n.mcmc.tuningInterval})`,
    'mymcmc.operatorSummary()',
    '',
  )
  emit('# Quit RevBayes after the analysis', 'q()', '')
  endSection()

  const script = lines.join('\n')
  let validation = null
  if (options.catalog !== undefined && options.catalog !== null) {
    validation = validateScript(script, {
      catalog: options.catalog,
      sourcePath: options.sourcePath ?? null,
      baseDir: options.baseDir ?? null,
      checkFiles: false,
      strict: true,
    })
    diagnostics.push(...validation.diagnostics)
  }
  const ok = diagnostics.every((d) => d.severity !== 'error')
  return {
    ok,
    script,
    diagnostics,
    warnings,
    sections,
    name: n.name,
    spec: n,
    validation,
    stats: {
      lines: script.split('\n').length,
      bytes: Buffer.byteLength(script, 'utf8'),
      monitors: 3,
      moves: countMoves(script),
    },
  }
}

function countMoves(script) {
  return (script.match(/moves\.append\(/g) ?? []).length
}

export { normalizeSpec, sectionTag, sanitizeName }
