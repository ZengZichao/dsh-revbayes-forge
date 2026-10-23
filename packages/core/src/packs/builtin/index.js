/**
 * Built-in model packs shipped inside the core bundle.
 *
 * The files in this directory are the canonical plugin-owned copies of the
 * pack manifests. The packages/pack-* workspace directories remain as thin
 * development re-exports, so pack tests and docs stay usable without adding
 * more DSH bundles to a profile.
 */
import biogeo from './biogeo.js'
import chromosome from './chromosome.js'
import coalescentDemography from './coalescent-demography.js'
import continuousTraits from './continuous-traits.js'
import dating from './dating.js'
import diversification from './diversification.js'
import fbd from './fbd.js'
import hostRepertoire from './host-repertoire.js'
import modelSelection from './model-selection.js'
import molecularSelection from './molecular-selection.js'
import morphologyAdvanced from './morphology-advanced.js'
import pps from './pps.js'
import ted from './ted.js'

export const BUILTIN_PACKS = Object.freeze([
  fbd,
  dating,
  coalescentDemography,
  diversification,
  continuousTraits,
  biogeo,
  morphologyAdvanced,
  chromosome,
  molecularSelection,
  hostRepertoire,
  pps,
  modelSelection,
  ted,
])

export const BUILTIN_PACK_IDS = Object.freeze(BUILTIN_PACKS.map((pack) => pack.id))

export default BUILTIN_PACKS
