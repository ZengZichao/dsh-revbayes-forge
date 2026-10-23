/** `revbayes_lookup` tool: search the bundled RevBayes help/signature catalog. */
import { lookupEntry, searchCatalog } from '../rev/catalog.js'
import { codeFence } from './shared.js'

function inputSchema() {
  return {
    query: { type: 'string', required: true, description: 'Function, distribution, move, monitor, method name, or a keyword such as "GTR" or "tree prior".' },
    kind: {
      type: 'string',
      enum: ['any', 'function', 'constructor', 'distribution', 'move', 'monitor', 'method'],
      description: 'Restrict results by RevBayes object kind. Default any.',
    },
    limit: { type: 'number', description: 'Maximum results (1-20, default 8).' },
    include_examples: { type: 'boolean', description: 'Include the help example when available (default true).' },
  }
}

function outputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', required: true },
      count: { type: 'number', required: true },
      catalog: {
        type: 'object', additionalProperties: false,
        properties: {
          entries: { type: 'number', required: true },
          signatures: { type: 'number', required: true },
          methods: { type: 'number', required: true },
          source: { type: 'string', required: true },
        },
      },
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            canonical_name: { type: 'string', required: true },
            kinds: { type: 'array', items: { type: 'string' }, required: true },
            title: { type: 'string' },
            description: { type: 'string' },
            usages: { type: 'array', items: { type: 'string' }, required: true },
            methods: { type: 'array', items: { type: 'string' } },
            example: { type: 'string' },
            see_also: { type: 'array', items: { type: 'string' } },
            legacy: { type: 'boolean' },
          },
        },
      },
    },
  }
}

function usageList(entry, query) {
  const usages = []
  for (const signature of entry.signatures ?? []) usages.push(signature.usage)
  const methodNeedle = query.includes('.') ? query.split('.').at(-1) : null
  for (const method of entry.methods ?? []) {
    if (methodNeedle !== null && method.name.toLowerCase() !== methodNeedle.toLowerCase()) continue
    usages.push(`${entry.name}.${method.name}${method.usage.slice(method.usage.indexOf('('))}`)
  }
  return usages.slice(0, 10)
}

function renderReport(value) {
  const lines = [`${value.count} result(s) for ${JSON.stringify(value.query)} (${value.catalog.entries} entries, ${value.catalog.signatures} signatures).`]
  for (const result of value.results) {
    lines.push('', `### ${result.name}${result.title ? ` — ${result.title}` : ''}${result.legacy ? ' [legacy]' : ''}`)
    if (result.description) lines.push(result.description)
    if (result.usages.length > 0) lines.push('', 'Usages:', codeFence(result.usages.join('\n'), 'text'))
    if (result.example) lines.push('', 'Example:', codeFence(result.example, 'rev'))
    if (result.see_also.length > 0) lines.push('', `See also: ${result.see_also.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Build the lookup tool definition.
 * @param {{catalog: object}} services
 */
export function createLookupTool(services) {
  return {
    name: 'revbayes_lookup',
    description:
      'Look up RevBayes functions, distributions, moves, monitors, and methods in the bundled help catalog. '
      + 'Returns exact usage signatures, argument names/defaults, enum options, descriptions, and examples. '
      + 'Use this before writing or repairing a call whose argument names or signature you are unsure about '
      + '(for example mcmc.run, dnPhyloCTMC, or mvScale).',
    parameters: inputSchema(),
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const query = args.query.trim()
      if (query.length === 0) throw new Error('query must be a non-empty string')
      const limit = Math.max(1, Math.min(Number(args.limit ?? 8) || 8, 20))
      const includeExamples = args.include_examples !== false
      const exact = lookupEntry(services.catalog, query)
      let entries = []
      if (exact !== null) entries = [exact]
      else if (query.includes('.')) {
        const [owner, method] = query.split('.')
        const entry = lookupEntry(services.catalog, owner)
        if (entry !== null && entry.methods.some((m) => m.name.toLowerCase() === (method ?? '').toLowerCase())) entries = [entry]
      }
      if (entries.length === 0) {
        entries = searchCatalog(services.catalog, query, { kind: args.kind ?? 'any', limit })
      }
      const results = entries.slice(0, limit).map((entry) => ({
        name: entry.name,
        canonical_name: entry.name,
        kinds: entry.kinds,
        ...(entry.title ? { title: entry.title } : {}),
        ...(entry.description ? { description: entry.description } : {}),
        usages: usageList(entry, query),
        methods: (entry.methods ?? []).slice(0, 8).map((m) => `${m.name}${m.usage.slice(m.usage.indexOf('('))}`),
        ...(includeExamples && entry.example ? { example: entry.example } : {}),
        see_also: entry.seeAlso ?? [],
        ...(entry.legacy === true ? { legacy: true } : {}),
      }))
      return {
        query,
        count: results.length,
        catalog: {
          entries: services.catalog.meta.entries ?? Object.keys(services.catalog.entries).length,
          signatures: services.catalog.meta.signatures ?? 0,
          methods: services.catalog.meta.methods ?? 0,
          source: 'revbayes.github.io-source/_data/help.yml',
        },
        results,
      }
    },
  }
}
