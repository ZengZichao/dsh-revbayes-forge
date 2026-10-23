/** `revbayes_generate` tool: structured analysis spec -> validated Rev script. */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { generateScript } from '../rev/generator.js'
import { resolveUserPath, sessionCwd, assertWriteAllowed, isWithin } from '../paths.js'
import {
  DIAGNOSTIC_OUTPUT,
  codeFence,
  formatDiagnostics,
  summarizeDiagnostics,
} from './shared.js'

function inputSchema() {
  return {
    spec: {
      type: 'object',
      required: true,
      additionalProperties: false,
      description: 'Analysis specification. Use analysis=dna or analysis=morphology and fill data, substitution, tree, and mcmc. For partitioned analyses provide data.partitions instead of data.file; analysis may be omitted.',
      properties: {
        analysis: { type: 'string', enum: ['dna', 'morphology', 'partition'], description: 'Analysis family. Omit for a partitioned spec with data.partitions.' },
        name: { type: 'string', description: 'Base name for the script and monitor files. Defaults to <analysis>_<model>.' },
        data: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            file: { type: 'string', description: 'Character matrix path (Nexus/PHYLIP), relative to the working directory. Required unless data.partitions is present.' },
            type: { type: 'string', enum: ['DNA', 'RNA', 'Standard', 'Binary'], description: 'Data type for dnPhyloCTMC. Defaults to DNA for dna, Standard for morphology.' },
            state_count: { type: 'number', description: 'Number of observed states for morphology (default 2). DNA/RNA must be 4.' },
            partitions: {
              type: 'array',
              description: 'Partitioned analysis: one alignment per entry. When present, data.file is not required and per-partition substitution settings are read from substitution.per_partition.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true, description: 'Partition identifier used in variable and monitor names.' },
                  file: { type: 'string', required: true, description: 'Alignment path for this partition.' },
                  type: { type: 'string', enum: ['DNA', 'RNA', 'Standard', 'Binary'], description: 'Data type (default DNA).' },
                  state_count: { type: 'number', description: 'Observed state count (default 4 for DNA/RNA, 2 otherwise).' },
                  taxa: { type: 'array', items: { type: 'string' }, description: 'Optional taxon list used to check that all partitions share taxa.' },
                },
              },
            },
          },
        },
        substitution: {
          type: 'object',
          additionalProperties: false,
          properties: {
            model: { type: 'string', enum: ['JC', 'F81', 'K80', 'HKY', 'GTR'], description: 'DNA substitution model. Morphology supports JC/Mk only. Default JC.' },
            base_frequencies: {
              oneOf: [
                { type: 'string', enum: ['estimated'] },
                { type: 'array', items: { type: 'number' } },
              ],
              description: 'F81/HKY/GTR base frequencies: "estimated" (default) or four positive numbers summing to 1.',
            },
            kappa: {
              oneOf: [{ type: 'string', enum: ['estimated'] }, { type: 'number' }],
              description: 'K80/HKY transition/transversion ratio: "estimated" (default) or a positive number.',
            },
            exchangeabilities: {
              oneOf: [
                { type: 'string', enum: ['estimated'] },
                { type: 'array', items: { type: 'number' } },
              ],
              description: 'GTR exchangeabilities: "estimated" (default) or six positive numbers.',
            },
            invariant_sites: {
              oneOf: [{ type: 'string', enum: ['estimated'] }, { type: 'number' }],
              description: 'Enable +I: a probability in [0,1) or "estimated". Omit to disable.',
            },
            gamma: {
              type: 'object',
              additionalProperties: false,
              description: 'Enable +G with discretized gamma rates.',
              properties: {
                shape: {
                  oneOf: [{ type: 'string', enum: ['estimated'] }, { type: 'number' }],
                  description: 'Gamma shape: "estimated" (default) or a positive number.',
                },
                categories: { type: 'number', description: 'Number of rate categories (default 4).' },
              },
            },
            per_partition: {
              type: 'object',
              additionalProperties: true,
              description: 'Per-partition substitution overrides keyed by data.partitions[].name; each value accepts model, base_frequencies, kappa, exchangeabilities, gamma, and invariant_sites.',
            },
          },
        },
        tree: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', enum: ['uniform', 'fixed'], description: 'Uniform topology prior or a fixed tree file. Default uniform.' },
            file: { type: 'string', description: 'Tree file; required when source=fixed.' },
            outgroup: { type: 'array', items: { type: 'string' }, description: 'Taxon names forming the outgroup for a uniform topology.' },
            branch_lengths: { type: 'string', enum: ['estimated', 'fixed'], description: 'Estimate iid branch lengths or use the fixed tree branch lengths. Default estimated for uniform, fixed for a fixed tree.' },
            prior: { type: 'string', enum: ['exponential', 'gamma', 'lognormal', 'uniform'], description: 'Branch-length prior when estimated. Default exponential.' },
            prior_arguments: { type: 'array', items: { type: 'number' }, description: 'Prior parameters: exponential [rate]; gamma [shape,rate]; lognormal [meanlog,sdlog]; uniform [min,max].' },
          },
        },
        mcmc: {
          type: 'object',
          additionalProperties: false,
          properties: {
            generations: { type: 'number', description: 'MCMC generations (default 10000).' },
            nruns: { type: 'number', description: 'Independent chains (default 1).' },
            sample_every: { type: 'number', description: 'Monitor printgen for parameter/tree files (default 10).' },
            screen_every: { type: 'number', description: 'Screen monitor printgen (default 100).' },
            tuning_interval: { type: 'number', description: 'Move-tuning interval (default min(100, generations)).' },
            moveschedule: { type: 'string', enum: ['random', 'sequential', 'single'], description: 'MCMC move schedule (default random).' },
            combine: { type: 'string', enum: ['sequential', 'mixed', 'none'], description: 'How multiple runs combine (default mixed; used when nruns > 1).' },
            output_dir: { type: 'string', description: 'Directory for monitor files, relative to the script. Empty means the current directory.' },
          },
        },
        script: {
          type: 'object',
          additionalProperties: false,
          properties: {
            header: { type: 'boolean', description: 'Include the generated-file header (default true).' },
          },
        },
      },
    },
    output_path: { type: 'string', description: 'Optional path to write the generated script. Relative paths resolve against the session workspace.' },
    overwrite: { type: 'boolean', description: 'Overwrite an existing output file (default false).' },
  }
}

function outputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      name: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      script: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      written: { type: 'boolean', required: true },
      created_output_dir: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            start_line: { type: 'number', required: true },
            end_line: { type: 'number', required: true },
          },
        },
      },
      warnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: { code: { type: 'string' }, message: { type: 'string', required: true } },
        },
      },
      diagnostics: { type: 'array', items: DIAGNOSTIC_OUTPUT },
      summary: {
        type: 'object',
        additionalProperties: false,
        properties: {
          error: { type: 'number', required: true },
          warning: { type: 'number', required: true },
          info: { type: 'number', required: true },
        },
      },
      stats: {
        oneOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              lines: { type: 'number', required: true },
              bytes: { type: 'number', required: true },
              moves: { type: 'number', required: true },
              monitors: { type: 'number', required: true },
            },
          },
        ],
      },
    },
  }
}

function renderReport(value) {
  const lines = []
  if (value.ok) {
    lines.push(`Generated ${value.name ?? 'script'}${value.path !== null ? ` → ${value.path}` : ' (not written; pass output_path to save it)'}.`)
  } else {
    lines.push('Generation failed; fix the diagnostics below.')
  }
  if (value.stats !== null) lines.push(`Stats: ${value.stats.lines} lines, ${value.stats.bytes} bytes, ${value.stats.moves} move statements, ${value.stats.monitors} monitors.`)
  if (value.created_output_dir !== null) lines.push(`Created output directory: ${value.created_output_dir}`)
  if (value.warnings.length > 0) {
    lines.push('', 'Warnings:', ...value.warnings.map((w) => `- ${w.code ?? 'warning'}: ${w.message}`))
  }
  const diagnostics = value.diagnostics.filter((d) => d.severity !== 'info')
  if (diagnostics.length > 0) {
    lines.push('', 'Diagnostics:', formatDiagnostics(diagnostics, 30))
  }
  if (value.script !== null) {
    lines.push('', 'Script:', codeFence(value.script, 'rev'))
  }
  return lines.join('\n')
}

/**
 * Build the generate tool definition.
 * @param {{config: object, catalog: object}} services
 */
export function createGenerateTool(services) {
  return {
    name: 'revbayes_generate',
    description:
      'Generate a runnable RevBayes script from a structured phylogenetic analysis specification '
      + '(DNA JC/F81/K80/HKY/GTR with optional +I/+G, or a morphology Mk analysis), covering data loading, '
      + 'substitution and tree models, moves, monitors, and MCMC settings. The script is self-validated '
      + 'against the bundled RevBayes signature catalog before it is returned. Use this instead of writing '
      + 'RevBayes grammar from memory; then call revbayes_validate with mode="dry" or "smoke" before running '
      + 'a real analysis. Pass output_path to save the script inside the workspace.',
    parameters: inputSchema(),
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const workspace = sessionCwd(exec)
      let outputPath = null
      if (typeof args.output_path === 'string' && args.output_path.trim().length > 0) {
        try {
          outputPath = resolveUserPath(args.output_path, workspace)
          assertWriteAllowed(outputPath, workspace, services.config.allowWriteOutsideWorkspace)
        } catch (error) {
          return failedResult([{
            severity: 'error', code: 'RB5800', message: error.message, source: 'generator',
            suggestion: 'Use a path inside the session workspace, or enable allowWriteOutsideWorkspace in the plugin config.',
          }])
        }
      }
      const baseDir = outputPath !== null ? dirname(outputPath) : workspace
      const result = generateScript(args.spec, { catalog: services.catalog, baseDir })

      const diagnostics = [...result.diagnostics]
      let written = false
      let createdOutputDir = null
      if (result.ok && outputPath !== null) {
        if (existsSync(outputPath) && args.overwrite !== true) {
          diagnostics.push({
            severity: 'error', code: 'RB5801', message: `Refusing to overwrite existing file: ${outputPath}`,
            source: 'generator', suggestion: 'Pass overwrite=true or choose another output_path.',
          })
        } else {
          try {
            mkdirSync(dirname(outputPath), { recursive: true })
            const tempPath = `${outputPath}.tmp-${process.pid}`
            writeFileSync(tempPath, result.script, 'utf8')
            renameSync(tempPath, outputPath)
            written = true
            const outputDir = result.spec?.mcmc?.outputDir
            if (typeof outputDir === 'string' && outputDir.length > 0) {
              const dir = resolveUserPath(outputDir, dirname(outputPath))
              if (!isWithin(workspace, dir) && services.config.allowWriteOutsideWorkspace !== true) {
                diagnostics.push({
                  severity: 'warning', code: 'RB5802',
                  message: `The monitor output directory ${dir} is outside the workspace and was not created.`,
                  source: 'generator', suggestion: 'Create it manually before running the script, or choose output_dir inside the workspace.',
                })
              } else {
                mkdirSync(dir, { recursive: true })
                createdOutputDir = dir
              }
            }
          } catch (error) {
            diagnostics.push({
              severity: 'error', code: 'RB5803', message: `Could not write the script: ${error.message}`,
              source: 'generator', suggestion: 'Check permissions and the parent directory.',
            })
          }
        }
      }

      const summary = summarizeDiagnostics(diagnostics)
      const ok = result.ok && summary.error === 0
      return {
        ok,
        name: result.name,
        script: result.script,
        path: outputPath,
        written,
        created_output_dir: createdOutputDir,
        sections: (result.sections ?? []).map((s) => ({ name: s.name, start_line: s.startLine, end_line: s.endLine ?? s.startLine })),
        warnings: result.warnings ?? [],
        diagnostics,
        summary,
        stats: result.stats ?? null,
      }
    },
  }
}

function failedResult(diagnostics) {
  return {
    ok: false,
    name: null,
    script: null,
    path: null,
    written: false,
    created_output_dir: null,
    sections: [],
    warnings: [],
    diagnostics,
    summary: summarizeDiagnostics(diagnostics),
    stats: null,
  }
}
