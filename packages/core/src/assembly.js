/**
 * Block assembly. Blocks declare the script section they emit plus the
 * variables, moves, monitors, diagnostics, and capabilities they introduce.
 * The assembly checks capabilities, detects duplicate variables, sorts
 * sections, renders the script, and (when a catalog is supplied) runs the core
 * static validator on the result.
 */
import { validateScript } from './rev/static-validator.js'

export const ASSEMBLY_VERSION = 1

export function sectionTag(title) {
  const inner = `# ${title} #`
  return ['#'.repeat(title.length + 4), inner, '#'.repeat(title.length + 4)].join('\n')
}

/** Create a block from a partial declaration. */
export function makeBlock(definition) {
  const block = {
    id: definition.id,
    version: definition.version ?? 1,
    requires: definition.requires ?? [],
    provides: definition.provides ?? [],
    build: typeof definition.build === 'function' ? definition.build : () => definition,
  }
  if (typeof definition.validate === 'function') block.validate = definition.validate
  return block
}

/** Convenience block that only emits a titled section. */
export function sectionBlock({
  id,
  title,
  order,
  lines,
  requires = [],
  provides = [],
  variables = [],
  moves = [],
  monitors = [],
  diagnostics = [],
  capabilities = [],
}) {
  return makeBlock({
    id,
    requires,
    provides,
    build: () => ({
      section: { title, order },
      lines,
      variables,
      moves,
      monitors,
      diagnostics,
      capabilities,
    }),
  })
}

function normalizeResult(result) {
  return {
    section: result.section ?? { title: result.title ?? 'Section', order: result.order ?? 100 },
    lines: result.lines ?? [],
    variables: result.variables ?? [],
    moves: result.moves ?? [],
    monitors: result.monitors ?? [],
    diagnostics: result.diagnostics ?? [],
    capabilities: result.capabilities ?? [],
  }
}

/** Create an assembly container. */
export function createAssembly({ catalog = null, context = {} } = {}) {
  const blocks = []
  const provided = new Set()
  const variables = new Map()
  const moves = []
  const monitors = []
  const diagnostics = []
  const warnings = []

  const assembly = {
    add(block) {
      if (block === null || typeof block !== 'object' || typeof block.build !== 'function') {
        throw new Error('assembly.add() expects a block produced by makeBlock()/sectionBlock()')
      }
      for (const capability of block.requires ?? []) {
        if (!provided.has(capability)) {
          throw new Error(`block ${block.id} requires capability "${capability}" before it is provided`)
        }
      }
      const result = normalizeResult(block.build(context))
      if (typeof block.validate === 'function') {
        const found = block.validate(context, result) ?? []
        diagnostics.push(...found)
      }
      for (const variable of result.variables) {
        if (variables.has(variable.name)) {
          throw new Error(`duplicate variable "${variable.name}" introduced by block ${block.id}`)
        }
        variables.set(variable.name, { ...variable, block: block.id })
      }
      moves.push(...result.moves.map((move) => ({ ...move, block: block.id })))
      monitors.push(...result.monitors.map((monitor) => ({ ...monitor, block: block.id })))
      diagnostics.push(...result.diagnostics)
      for (const capability of block.provides ?? []) provided.add(capability)
      for (const capability of result.capabilities) provided.add(capability)
      blocks.push({ block, result })
      return assembly
    },

    has(capability) {
      return provided.has(capability)
    },

    finish() {
      const sections = blocks
        .map((entry, index) => ({ ...entry, index }))
        .sort((a, b) => (a.result.section.order ?? 100) - (b.result.section.order ?? 100) || a.index - b.index)
      const lines = []
      const rendered = []
      for (const entry of sections) {
        if (lines.length > 0) lines.push('')
        const startLine = lines.length + 1
        lines.push(sectionTag(entry.result.section.title), '')
        lines.push(...entry.result.lines)
        rendered.push({
          name: entry.result.section.title,
          startLine,
          endLine: lines.length,
          block: entry.block.id,
        })
      }
      while (lines.length > 0 && lines.at(-1) === '') lines.pop()
      const script = lines.join('\n')
      let validation = null
      const allDiagnostics = [...diagnostics]
      if (catalog !== null) {
        validation = validateScript(script, {
          catalog,
          checkFiles: false,
          strict: true,
          sourcePath: context.sourcePath ?? null,
          baseDir: context.baseDir ?? null,
        })
        allDiagnostics.push(...validation.diagnostics)
      }
      return {
        script,
        sections: rendered,
        warnings,
        diagnostics: allDiagnostics,
        validation,
        variables: [...variables.values()],
        moves,
        monitors,
        capabilities: [...provided],
        stats: {
          blocks: blocks.length,
          sections: rendered.length,
          lines: script.split('\n').length,
          bytes: Buffer.byteLength(script, 'utf8'),
          moves: String(script).match(/moves\.append\(/g)?.length ?? 0,
          monitors: String(script).match(/monitors\.append\(/g)?.length ?? 0,
        },
      }
    },
  }
  return assembly
}

/**
 * Recipe helper: declares required packs and blocks, then composes a script
 * from an assembly. Packs never import each other; the recipe is the only
 * cross-pack composition surface.
 */
export function createRecipe(forge, id) {
  const packs = []
  const capabilities = []
  const recipe = {
    id,
    requirePack(packId, range = null) {
      packs.push({ pack: packId, range })
      return recipe
    },
    requireBlock(capability) {
      if (!capabilities.includes(capability)) capabilities.push(capability)
      return recipe
    },
    check() {
      const diagnostics = []
      for (const requirement of packs) {
        if (!forge.isPackActive(requirement.pack)) {
          diagnostics.push({
            severity: 'error',
            code: 'RB4007',
            source: `recipe:${id}`,
            message: `recipe "${id}" requires pack "${requirement.pack}", which is not installed or not enabled.`,
            suggestion: `Install and enable ${requirement.pack}, or check revbayes_environment.`,
          })
        }
      }
      return { ok: diagnostics.length === 0, diagnostics, packs: [...packs], blocks: [...capabilities] }
    },
    compose(assemble) {
      const checked = recipe.check()
      if (!checked.ok) return { ok: false, script: null, diagnostics: checked.diagnostics, sections: [], stats: null }
      const result = assemble()
      return { ...result, ok: (result.diagnostics ?? []).every((d) => d.severity !== 'error') }
    },
  }
  return recipe
}
