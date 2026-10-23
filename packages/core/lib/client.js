/**
 * RevBayes Forge — browser half.
 *
 * One settings section manages the whole product: core status, all 13 built-in
 * packs, the RevBayes environment, script generation, and validation. The host
 * owns every filesystem and process action; this module only talks to the
 * routes under /plugins/dsh-revbayes-forge/.
 */
window.__ModuleLoader__.load({
  id: 'dsh-revbayes-forge',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const NS = 'revbayes-forge'
    const API = '/plugins/dsh-revbayes-forge'
    const MATURITY_ORDER = { verified: 0, golden: 1, experimental: 2 }

    const SAMPLE_SPECS = {
      fbd: {
        analysis: 'fbd',
        name: 'fbd_demo',
        data: { file: 'data/bears_morphology.nex', taxa_file: 'data/bears_taxa.tsv', matrix_file: 'data/bears_morphology.nex', type: 'Standard', state_count: 2 },
        substitution: { model: 'Mk', gamma: { categories: 4 } },
        fbd: { lambda: 1, mu: 0.2, psi: 0.1, rho: 1, origin: 45 },
        mcmc: { generations: 20000, sample_every: 10 },
      },
      dating: {
        analysis: 'strict_clock',
        name: 'dating_strict',
        data: { file: 'data/dna.nex' },
        tree: { file: 'data/tree.tre' },
        substitution: { model: 'GTR' },
        clock: { model: 'strict', rate: 1 },
        mcmc: { generations: 20000 },
      },
      'coalescent-demography': {
        analysis: 'multispecies_coalescent',
        name: 'msc_demo',
        data: { file: 'data/dna.nex', species_tree: 'data/tree.tre' },
        substitution: { model: 'JC' },
        demography: { population_size: 0.01 },
        mcmc: { generations: 20000 },
      },
      diversification: {
        analysis: 'birthdeath',
        name: 'bd_demo',
        data: { tree: 'data/tree.tre' },
        model: { birth_rate: 0.1, death_rate: 0.01, sampling: 1 },
        mcmc: { generations: 20000 },
      },
      'continuous-traits': {
        analysis: 'bm',
        name: 'bm_demo',
        data: { file: 'data/traits.nex' },
        tree: { file: 'data/tree.tre' },
        model: { sigma2: 0.1 },
        mcmc: { generations: 20000 },
      },
      ted: {
        analysis: 'ted',
        name: 'ted_demo',
        base_spec: {
          analysis: 'fbd',
          data: { file: 'data/bears_morphology.nex', taxa_file: 'data/bears_taxa.tsv', matrix_file: 'data/bears_morphology.nex', type: 'Standard', state_count: 2 },
          substitution: { model: 'Mk' },
          fbd: { lambda: 1, mu: 0.2, psi: 0.1, rho: 1, origin: 45 },
        },
        extant_taxa: ['A', 'B', 'C'],
        calibrations: [{ name: 'root_calibration', min: 30, max: 60 }],
        mcmc: { generations: 20000, sample_every: 10 },
      },
    }

    function sampleFor(pack, analysis) {
      const sample = SAMPLE_SPECS[pack]
      if (sample === undefined) return { mcmc: { generations: 10000 } }
      return { ...sample, analysis: analysis ?? sample.analysis }
    }

    async function request(path, options = {}) {
      const response = await fetch(`${API}${path}`, {
        method: options.method ?? 'GET',
        headers: options.body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`服务返回了无法解析的响应（HTTP ${response.status}）。`)
      }
      if (!response.ok || payload.ok === false) {
        const detail = payload?.error
        const error = new Error(detail?.message ?? `请求失败（HTTP ${response.status}）。`)
        error.code = detail?.code ?? ''
        error.path = detail?.path ?? ''
        throw error
      }
      return payload
    }

    function classNames(...values) {
      return values.filter(Boolean).join(' ')
    }

    const CSS = `
      .rbf-page {
        box-sizing: border-box;
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
        padding: 4px 4px 40px;
        color: var(--dsw-alias-label-primary, #1b1b1f);
        font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        text-align: left;
      }
      .rbf-title { margin: 2px 0 4px; font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
      .rbf-subtitle { margin: 0 0 16px; color: var(--dsw-alias-label-secondary, #666); font-size: 12.5px; }
      .rbf-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; margin-bottom: 18px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.09)); }
      .rbf-tab { appearance: none; border: 0; border-radius: 7px; padding: 7px 13px; background: transparent; color: var(--dsw-alias-label-secondary, #666); font: inherit; font-weight: 520; cursor: pointer; }
      .rbf-tab:hover { color: var(--dsw-alias-label-primary, #1b1b1f); }
      .rbf-tab[aria-selected="true"] { background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #1b1b1f); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
      .rbf-panel { display: flex; flex-direction: column; gap: 16px; }
      .rbf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
      .rbf-card { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); border-radius: 10px; padding: 13px 14px; background: var(--dsw-alias-bg-overlay, #fff); }
      .rbf-card-label { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
      .rbf-card-value { margin-top: 4px; font-size: 18px; font-weight: 640; overflow-wrap: anywhere; }
      .rbf-card-note { margin-top: 3px; color: var(--dsw-alias-label-secondary, #666); font-size: 11.5px; overflow-wrap: anywhere; }
      .rbf-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
      .rbf-section-head h3 { margin: 0; font-size: 14px; font-weight: 640; }
      .rbf-muted { color: var(--dsw-alias-label-secondary, #666); }
      .rbf-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
      .rbf-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
      .rbf-kv { display: grid; grid-template-columns: minmax(130px, 190px) 1fr; gap: 7px 14px; align-items: start; }
      .rbf-kv dt { color: var(--dsw-alias-label-secondary, #666); }
      .rbf-kv dd { margin: 0; overflow-wrap: anywhere; }
      .rbf-badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 1px 8px; font-size: 10.5px; font-weight: 620; border: 1px solid transparent; white-space: nowrap; }
      .rbf-badge.verified { background: rgba(46,160,90,.13); color: #207a45; border-color: rgba(46,160,90,.25); }
      .rbf-badge.golden { background: rgba(206,145,36,.14); color: #8a5a05; border-color: rgba(206,145,36,.28); }
      .rbf-badge.experimental { background: rgba(190,70,70,.12); color: #a13a3a; border-color: rgba(190,70,70,.25); }
      .rbf-badge.ok { background: rgba(46,160,90,.13); color: #207a45; }
      .rbf-badge.warn { background: rgba(206,145,36,.14); color: #8a5a05; }
      .rbf-badge.off { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); color: var(--dsw-alias-label-secondary, #666); }
      .rbf-pack { display: flex; flex-direction: column; gap: 9px; }
      .rbf-pack-head { display: flex; align-items: flex-start; gap: 10px; }
      .rbf-check { width: 15px; height: 15px; margin: 3px 0 0; accent-color: #4d6bfe; }
      .rbf-pack-title { font-weight: 640; font-size: 13.5px; }
      .rbf-pack-id { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; }
      .rbf-pack-body { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 10px 18px; padding-left: 25px; }
      @media (max-width: 640px) { .rbf-pack-body { grid-template-columns: 1fr; } }
      .rbf-label { color: var(--dsw-alias-label-tertiary, #888); font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
      .rbf-chips { display: flex; flex-wrap: wrap; gap: 4px; }
      .rbf-chip { padding: 1px 7px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); font-size: 11px; overflow-wrap: anywhere; }
      .rbf-chip.blocked { background: rgba(190,70,70,.12); color: #a13a3a; }
      .rbf-dep { display: flex; gap: 5px; flex-wrap: wrap; font-size: 11.5px; }
      .rbf-dep-ok { color: #207a45; }
      .rbf-dep-missing { color: #a13a3a; font-weight: 600; }
      .rbf-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .rbf-btn { appearance: none; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #1b1b1f); font: inherit; font-weight: 560; padding: 6px 13px; cursor: pointer; }
      .rbf-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
      .rbf-btn:disabled { opacity: .55; cursor: default; }
      .rbf-btn.primary { background: #4d6bfe; border-color: #4d6bfe; color: #fff; }
      .rbf-btn.primary:hover:not(:disabled) { background: #3f5bea; border-color: #3f5bea; }
      .rbf-btn.danger { color: #a13a3a; }
      .rbf-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .rbf-field > span { color: var(--dsw-alias-label-secondary, #666); font-size: 11.5px; font-weight: 560; }
      .rbf-input, .rbf-select, .rbf-textarea { box-sizing: border-box; width: 100%; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); background: var(--dsw-alias-bg-base, #fff); color: inherit; font: inherit; padding: 7px 9px; }
      .rbf-textarea { min-height: 150px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; }
      .rbf-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
      .rbf-row > .rbf-field { flex: 1 1 180px; }
      .rbf-inline { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary, #666); font-size: 12px; }
      .rbf-note { border-radius: 8px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); color: var(--dsw-alias-label-secondary, #666); font-size: 12px; }
      .rbf-note.blue { background: rgba(77,107,254,.09); color: #33479f; }
      .rbf-note.red { background: rgba(190,70,70,.09); color: #8f3030; }
      .rbf-note.green { background: rgba(46,160,90,.1); color: #1f6d3e; }
      .rbf-empty { padding: 28px 12px; text-align: center; color: var(--dsw-alias-label-tertiary, #888); font-size: 12.5px; }
      .rbf-loading { padding: 48px 12px; text-align: center; color: var(--dsw-alias-label-secondary, #666); }
      .rbf-pre { margin: 0; max-height: 360px; overflow: auto; border-radius: 8px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.5; white-space: pre; }
      .rbf-diagnostics { display: flex; flex-direction: column; gap: 5px; }
      .rbf-diag { display: grid; grid-template-columns: 58px 1fr; gap: 8px; padding: 7px 9px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07)); font-size: 12px; }
      .rbf-diag.error .rbf-sev { color: #a13a3a; }
      .rbf-diag.warning .rbf-sev { color: #8a5a05; }
      .rbf-diag.info .rbf-sev { color: #33479f; }
      .rbf-sev { font-weight: 680; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; }
      .rbf-diag-meta { color: var(--dsw-alias-label-tertiary, #888); font-size: 10.5px; margin-top: 2px; }
      .rbf-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; align-items: center; }
      .rbf-sticky-actions { position: sticky; bottom: 0; z-index: 2; padding: 10px 0 2px; background: linear-gradient(transparent, var(--dsw-alias-bg-base, #fff) 35%); }
    `

    function Badge({ kind, children }) {
      return h('span', { className: classNames('rbf-badge', kind) }, children)
    }

    function Notice({ tone = 'blue', children }) {
      return h('div', { className: classNames('rbf-note', tone) }, children)
    }

    function Diagnostics({ items, emptyText = '没有诊断。' }) {
      if (!Array.isArray(items) || items.length === 0) return h('div', { className: 'rbf-empty' }, emptyText)
      return h('div', { className: 'rbf-diagnostics' }, items.map((item, index) => h('div', {
        key: `${item.code ?? 'diag'}-${index}`,
        className: classNames('rbf-diag', item.severity ?? 'info'),
      }, [
        h('div', { key: 'sev', className: 'rbf-sev' }, item.severity ?? 'info'),
        h('div', { key: 'body' }, [
          h('div', { key: 'msg' }, item.message ?? ''),
          (item.code || item.line || item.path || item.suggestion)
            ? h('div', { key: 'meta', className: 'rbf-diag-meta' }, [
                item.code ? `${item.code}` : '',
                item.line ? ` · L${item.line}` : '',
                item.path ? ` · ${item.path}` : '',
                item.suggestion ? ` · ${item.suggestion}` : '',
              ].filter(Boolean).join(''))
            : null,
          item.correctUsage ? h('pre', { key: 'usage', className: 'rbf-pre', style: { marginTop: '5px', maxHeight: '120px' } }, item.correctUsage) : null,
        ]),
      ])))
    }

    function Overview({ state, onRefresh, busy }) {
      const { counts, revbayes, environment, catalog, tools } = state
      const cards = [
        { label: 'Core', value: state.core.status === 'ready' ? '运行中' : state.core.status, note: `coreApi ${state.core.api_version}` },
        { label: 'RevBayes', value: revbayes.found ? (revbayes.version || '已检测') : '未找到', note: revbayes.binary || '静态校验可用' },
        { label: 'Catalog', value: String(catalog.entries), note: `${catalog.signatures} signatures · ${catalog.methods} methods` },
        { label: '已启用 Pack', value: `${counts.enabled_packs} / ${counts.packs}`, note: `${counts.blocked_packs} blocked` },
        { label: '活动工具', value: String(counts.active_tools), note: `${counts.core_tools} core + ${counts.pack_tools} pack` },
        { label: '未覆盖分析族', value: String(state.uncovered_families.length), note: state.uncovered_families.length === 0 ? '全部有归属' : state.uncovered_families.join(', ') },
      ]
      return h('div', { className: 'rbf-panel' }, [
        h('div', { key: 'cards', className: 'rbf-grid' }, cards.map((card) => h('div', { key: card.label, className: 'rbf-card' }, [
          h('div', { key: 'label', className: 'rbf-card-label' }, card.label),
          h('div', { key: 'value', className: 'rbf-card-value' }, card.value),
          h('div', { key: 'note', className: 'rbf-card-note' }, card.note),
        ]))),
        !revbayes.found ? h(Notice, { key: 'rb', tone: 'warn' }, '未检测到 RevBayes 可执行文件。生成与静态校验仍可用；dry / smoke 需要在 Environment 中指定 rb 路径或将其加入 PATH。') : null,
        h('div', { key: 'tools', className: 'rbf-card' }, [
          h('div', { key: 'head', className: 'rbf-section-head' }, [
            h('h3', { key: 'title' }, '当前模型可见工具'),
            h('span', { key: 'count', className: 'rbf-muted' }, `${tools.all.length} 个`),
          ]),
          h('div', { key: 'chips', className: 'rbf-chips' }, tools.all.map((name) => h('span', { key: name, className: 'rbf-chip' }, name))),
        ]),
        h('div', { key: 'actions', className: 'rbf-toolbar' }, [
          h('span', { key: 'note', className: 'rbf-muted' }, revbayes.found ? `rb: ${revbayes.binary}` : '配置状态来自当前 DSH 进程。'),
          h('button', { key: 'refresh', type: 'button', className: 'rbf-btn', disabled: busy, onClick: onRefresh }, busy ? '刷新中…' : '刷新状态'),
        ]),
      ])
    }

    function DependencyLine({ pack }) {
      const parts = []
      for (const dependency of pack.dependencies ?? []) {
        parts.push(h('span', { key: `dep-${dependency.pack}`, className: dependency.satisfied ? 'rbf-dep-ok' : 'rbf-dep-missing' }, `${dependency.pack}${dependency.optional ? '（可选）' : ''}${dependency.satisfied ? ' ✓' : ' 未启用'}`))
      }
      for (const analysis of pack.analyses ?? []) {
        for (const required of analysis.requires ?? []) {
          const active = analysis.blocked === null || analysis.blocked === undefined
          const suffix = analysis.id
          parts.push(h('span', { key: `req-${suffix}-${required}`, className: active ? 'rbf-dep-ok' : 'rbf-dep-missing' }, `${analysis.id} → ${required}${active ? ' ✓' : ' 未启用'}`))
        }
      }
      if (parts.length === 0) return h('span', { className: 'rbf-muted' }, '无强制依赖')
      return h('div', { className: 'rbf-dep' }, parts)
    }

    function PackCard({ pack, checked, onToggle }) {
      const blocked = pack.blocked !== null && pack.blocked !== undefined
      return h('div', { className: 'rbf-card rbf-pack' }, [
        h('div', { key: 'head', className: 'rbf-pack-head' }, [
          h('input', {
            key: 'check',
            type: 'checkbox',
            className: 'rbf-check',
            checked,
            'aria-label': `启用 ${pack.title}`,
            onChange: (event) => onToggle(pack.id, event.target.checked),
          }),
          h('div', { key: 'titles', style: { flex: '1 1 auto', minWidth: 0 } }, [
            h('div', { key: 't', className: 'rbf-pack-title' }, pack.title),
            h('div', { key: 'i', className: 'rbf-pack-id' }, `${pack.id} · v${pack.version}`),
          ]),
          h('div', { key: 'badges', className: 'rbf-chips' }, [
            h(Badge, { key: 'maturity', kind: pack.maturity }, pack.maturity),
            checked ? h(Badge, { key: 'state', kind: blocked ? 'experimental' : 'ok' }, blocked ? 'blocked' : 'enabled') : h(Badge, { key: 'state', kind: 'off' }, 'disabled'),
          ]),
        ]),
        blocked ? h(Notice, { key: 'blocked', tone: 'red' }, `无法启用：${pack.blocked}`) : null,
        h('div', { key: 'body', className: 'rbf-pack-body' }, [
          h('div', { key: 'analyses' }, [
            h('div', { key: 'label', className: 'rbf-label' }, '分析'),
            h('div', { key: 'chips', className: 'rbf-chips' }, (pack.analyses ?? []).map((analysis) => h('span', {
              key: analysis.id,
              className: classNames('rbf-chip', analysis.blocked ? 'blocked' : ''),
              title: analysis.blocked ?? analysis.title,
            }, `${analysis.id}${analysis.blocked ? ' · blocked' : ''}`))),
          ]),
          h('div', { key: 'tools' }, [
            h('div', { key: 'label', className: 'rbf-label' }, '工具'),
            h('div', { key: 'chips', className: 'rbf-chips' }, (pack.tools ?? []).map((tool) => h('span', { key: tool, className: 'rbf-chip' }, tool))),
          ]),
          h('div', { key: 'deps' }, [
            h('div', { key: 'label', className: 'rbf-label' }, '依赖'),
            h(DependencyLine, { key: 'line', pack }),
            pack.workflow?.baseSpec ? h('div', { key: 'wf', className: 'rbf-muted', style: { marginTop: '4px', fontSize: '11.5px' } }, pack.workflow.note) : null,
          ]),
          h('div', { key: 'desc' }, [
            h('div', { key: 'label', className: 'rbf-label' }, '说明'),
            h('div', { key: 'text', className: 'rbf-muted', style: { fontSize: '11.5px' } }, pack.description || '—'),
          ]),
        ]),
      ])
    }

    function PacksTab({ state, onStateChange, onRefresh, busy }) {
      const enabledFromState = useMemo(() => new Set(state.packs.filter((pack) => pack.enabled).map((pack) => pack.id)), [state])
      const [selected, setSelected] = useState(() => [...enabledFromState])
      const [message, setMessage] = useState(null)
      const [saving, setSaving] = useState(false)
      useEffect(() => { setSelected([...enabledFromState]) }, [enabledFromState])

      const toggle = (id, checked) => {
        setMessage(null)
        setSelected((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))
      }
      const save = async () => {
        setSaving(true)
        setMessage(null)
        try {
          const next = await request('/packs', { method: 'POST', body: { enabledPacks: selected } })
          onStateChange(next)
          const blocked = next.applied?.blocked ?? []
          setMessage({
            tone: blocked.length > 0 ? 'warn' : 'green',
            text: blocked.length > 0
              ? `已保存。${blocked.length} 个 pack 因依赖未满足而保持 blocked：${blocked.map((item) => `${item.id}（${item.reason}）`).join('；')}`
              : `已保存并立即生效。当前 ${next.counts.enabled_packs} 个 pack 启用，${next.counts.pack_tools} 个 pack 工具可见。设置已写入状态文件，重启 DSH 后仍会保留。`,
          })
        } catch (error) {
          setMessage({ tone: 'red', text: `${error.code ? `${error.code}: ` : ''}${error.message}` })
        } finally {
          setSaving(false)
        }
      }
      const verifiedOnly = () => setSelected(state.packs.filter((pack) => pack.maturity === 'verified').map((pack) => pack.id))
      const selectAll = () => setSelected(state.packs.map((pack) => pack.id))
      const clearAll = () => setSelected([])
      const dirty = selected.length !== enabledFromState.size || selected.some((id) => !enabledFromState.has(id))

      return h('div', { className: 'rbf-panel' }, [
        h('div', { key: 'note', className: 'rbf-note blue' }, [
          h('div', { key: 't', style: { fontWeight: 600, marginBottom: '2px' } }, '13 个模型包，一个插件统一管理'),
          h('div', { key: 'd' }, '勾选后保存会立即注册或注销对应工具；依赖未满足的 pack 会保持 blocked，不会产生半可用工具。默认只启用 verified。'),
        ]),
        h('div', { key: 'toolbar', className: 'rbf-toolbar' }, [
          h('div', { key: 'left', className: 'rbf-actions' }, [
            h('button', { key: 'verified', type: 'button', className: 'rbf-btn', onClick: verifiedOnly }, '仅 verified'),
            h('button', { key: 'all', type: 'button', className: 'rbf-btn', onClick: selectAll }, '全选'),
            h('button', { key: 'none', type: 'button', className: 'rbf-btn', onClick: clearAll }, '全不选'),
          ]),
          h('span', { key: 'count', className: 'rbf-muted' }, `已选 ${selected.length} / ${state.packs.length}`),
        ]),
        ...(message === null ? [] : [h(Notice, { key: 'message', tone: message.tone }, message.text)]),
        h('div', { key: 'packs', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [...state.packs]
          .sort((a, b) => (MATURITY_ORDER[a.maturity] ?? 9) - (MATURITY_ORDER[b.maturity] ?? 9) || a.title.localeCompare(b.title))
          .map((pack) => h(PackCard, { key: pack.id, pack, checked: selected.includes(pack.id), onToggle: toggle }))),
        h('div', { key: 'actions', className: 'rbf-sticky-actions' }, [
          h('div', { className: 'rbf-actions' }, [
            h('button', { key: 'save', type: 'button', className: 'rbf-btn primary', disabled: saving || !dirty, onClick: save }, saving ? '保存中…' : '保存并应用'),
            h('button', { key: 'refresh', type: 'button', className: 'rbf-btn', disabled: busy || saving, onClick: onRefresh }, '重新读取'),
            dirty ? h('span', { key: 'dirty', className: 'rbf-muted' }, '有未保存的更改') : null,
          ]),
        ]),
      ])
    }

    function EnvironmentTab({ state, onStateChange, busy, setBusy }) {
      const [detecting, setDetecting] = useState(false)
      const [detected, setDetected] = useState(null)
      const [binary, setBinary] = useState('')
      const environment = state.environment
      const revbayes = detected ?? state.revbayes
      const detect = async () => {
        setDetecting(true)
        setBusy(true)
        try {
          const value = await request('/detect', { method: 'POST', body: binary.trim().length > 0 ? { binary: binary.trim() } : {} })
          setDetected(value.revbayes)
          onStateChange({ ...state, revbayes: value.revbayes })
        } catch (error) {
          setDetected({ found: false, binary: '', version: '', source: '', checked: [], error: error.message })
        } finally {
          setDetecting(false)
          setBusy(false)
        }
      }
      return h('div', { className: 'rbf-panel' }, [
        h('div', { key: 'card', className: 'rbf-card' }, [
          h('div', { key: 'head', className: 'rbf-section-head' }, [
            h('h3', { key: 't' }, 'RevBayes 运行时'),
            h(Badge, { key: 'b', kind: revbayes.found ? 'ok' : 'warn' }, revbayes.found ? '已检测' : '未找到'),
          ]),
          h('dl', { key: 'kv', className: 'rbf-kv' }, [
            h('dt', { key: 'p' }, '二进制路径'), h('dd', { key: 'pv', className: 'rbf-mono' }, revbayes.binary || '—'),
            h('dt', { key: 'v' }, '版本'), h('dd', { key: 'vv' }, revbayes.version || '未知'),
            h('dt', { key: 's' }, '来源'), h('dd', { key: 'sv' }, revbayes.source || '—'),
            h('dt', { key: 'c' }, 'Allow runtime'), h('dd', { key: 'cv' }, environment.allow_runtime ? '是（dry / smoke 可用）' : '否（仅静态校验）'),
            h('dt', { key: 't' }, '超时'), h('dd', { key: 'tv' }, `${environment.timeout_ms} ms`),
            h('dt', { key: 'g' }, 'Smoke 代数上限'), h('dd', { key: 'gv' }, String(environment.max_run_generations)),
            h('dt', { key: 'w' }, '工作区'), h('dd', { key: 'wv', className: 'rbf-mono' }, environment.workspace),
            h('dt', { key: 'cp' }, 'Catalog 路径'), h('dd', { key: 'cpv', className: 'rbf-mono' }, environment.catalog_path),
            h('dt', { key: 'st' }, '状态文件'), h('dd', { key: 'stv', className: 'rbf-mono' }, state.state.file || '未配置'),
            h('dt', { key: 'wr' }, '工作区外写入'), h('dd', { key: 'wrv' }, environment.allow_write_outside_workspace ? '允许' : '禁止'),
          ]),
        ]),
        h('div', { key: 'detect', className: 'rbf-card' }, [
          h('div', { key: 'head', className: 'rbf-section-head' }, [h('h3', { key: 't' }, '检测 RevBayes')]),
          h('div', { key: 'row', className: 'rbf-row' }, [
            h('label', { key: 'field', className: 'rbf-field' }, [
              h('span', { key: 'l' }, '可执行文件路径（可选）'),
              h('input', {
                key: 'i',
                className: 'rbf-input',
                value: binary,
                placeholder: '留空则按配置、环境变量与 PATH 查找',
                onChange: (event) => setBinary(event.target.value),
              }),
            ]),
            h('button', { key: 'button', type: 'button', className: 'rbf-btn primary', disabled: detecting, onClick: detect }, detecting ? '检测中…' : '检测 RevBayes'),
          ]),
          detected !== null && !detected.found ? h(Notice, { key: 'miss', tone: 'red' }, `未找到 RevBayes。检查过的路径：${(detected.checked ?? []).join(', ') || '无'}${detected.error ? `（${detected.error}）` : ''}`) : null,
          detected !== null && detected.found ? h(Notice, { key: 'found', tone: 'green' }, `已找到 RevBayes ${detected.version || ''}：${detected.binary}`) : null,
        ]),
        h('div', { key: 'note', className: 'rbf-note' }, 'Environment 为即时读取的运行时配置。修改 rb 路径、超时或工作区请编辑 profile 的插件 config 后重启 DSH；设置页不会改写 cordis.patch.yml。'),
      ])
    }

    function GenerateTab({ state, setBusy }) {
      const enabledPacks = state.packs
      const [packId, setPackId] = useState(enabledPacks.find((pack) => pack.id === 'fbd')?.id ?? enabledPacks[0]?.id ?? '')
      const pack = enabledPacks.find((item) => item.id === packId) ?? null
      const [analysis, setAnalysis] = useState(pack?.analyses?.[0]?.id ?? '')
      const [spec, setSpec] = useState(() => JSON.stringify(sampleFor(packId, pack?.analyses?.[0]?.id), null, 2))
      const [outputPath, setOutputPath] = useState('scripts/revbayes_forge.Rev')
      const [overwrite, setOverwrite] = useState(false)
      const [result, setResult] = useState(null)
      const [error, setError] = useState(null)
      const [running, setRunning] = useState(false)

      useEffect(() => {
        const next = enabledPacks.find((item) => item.id === packId)
        const id = next?.analyses?.[0]?.id ?? ''
        setAnalysis(id)
        setSpec(JSON.stringify(sampleFor(packId, id), null, 2))
        setResult(null)
        setError(null)
      }, [packId])

      const run = async (write) => {
        setError(null)
        setResult(null)
        let parsed
        try {
          parsed = JSON.parse(spec)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Spec 必须是 JSON 对象。')
        } catch (parseError) {
          setError(`JSON 解析失败：${parseError.message}`)
          return
        }
        if (write && outputPath.trim().length === 0) {
          setError('写入工作区需要填写输出路径。')
          return
        }
        setRunning(true)
        setBusy(true)
        try {
          const value = await request('/generate', {
            method: 'POST',
            body: {
              pack: packId,
              analysis,
              spec: parsed,
              ...(write ? { outputPath: outputPath.trim(), overwrite } : {}),
            },
          })
          setResult(value.result)
        } catch (requestError) {
          setError(`${requestError.code ? `${requestError.code}: ` : ''}${requestError.message}${requestError.path ? `（${requestError.path}）` : ''}`)
        } finally {
          setRunning(false)
          setBusy(false)
        }
      }

      if (enabledPacks.length === 0) {
        return h('div', { className: 'rbf-empty' }, '当前没有已启用的 pack。请先在 Packs 页启用至少一个模型包。')
      }

      return h('div', { className: 'rbf-panel' }, [
        h('div', { key: 'form', className: 'rbf-card', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
          h('div', { key: 'row1', className: 'rbf-row' }, [
            h('label', { key: 'pack', className: 'rbf-field' }, [
              h('span', { key: 'l' }, 'Pack'),
              h('select', { key: 's', className: 'rbf-select', value: packId, onChange: (event) => setPackId(event.target.value) }, enabledPacks.map((item) => h('option', { key: item.id, value: item.id }, `${item.title} (${item.id})`))),
            ]),
            h('label', { key: 'analysis', className: 'rbf-field' }, [
              h('span', { key: 'l' }, '分析'),
              h('select', { key: 's', className: 'rbf-select', value: analysis, onChange: (event) => { setAnalysis(event.target.value); setSpec(JSON.stringify(sampleFor(packId, event.target.value), null, 2)) } }, (pack?.analyses ?? []).map((item) => h('option', { key: item.id, value: item.id }, `${item.id}${item.blocked ? ' · blocked' : ''}`))),
            ]),
          ]),
          h('label', { key: 'spec', className: 'rbf-field' }, [
            h('span', { key: 'l', style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [
              h('span', { key: 't' }, 'JSON Spec'),
              h('button', { key: 'sample', type: 'button', className: 'rbf-btn', style: { padding: '2px 8px', fontSize: '11px' }, onClick: () => setSpec(JSON.stringify(sampleFor(packId, analysis), null, 2)) }, '填入示例'),
            ]),
            h('textarea', { key: 'ta', className: 'rbf-textarea', spellCheck: false, value: spec, onChange: (event) => setSpec(event.target.value) }),
          ]),
          h('div', { key: 'row2', className: 'rbf-row' }, [
            h('label', { key: 'out', className: 'rbf-field' }, [
              h('span', { key: 'l' }, '输出路径（相对工作区，或绝对路径）'),
              h('input', { key: 'i', className: 'rbf-input', value: outputPath, onChange: (event) => setOutputPath(event.target.value) }),
            ]),
            h('label', { key: 'ov', className: 'rbf-inline', style: { paddingBottom: '8px' } }, [
              h('input', { key: 'c', type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }),
              h('span', { key: 't' }, '允许覆盖'),
            ]),
          ]),
          pack?.workflow?.baseSpec ? h(Notice, { key: 'wf', tone: 'blue' }, pack.workflow.note) : null,
          h('div', { key: 'actions', className: 'rbf-actions' }, [
            h('button', { key: 'preview', type: 'button', className: 'rbf-btn primary', disabled: running, onClick: () => run(false) }, running ? '生成中…' : '生成预览'),
            h('button', { key: 'write', type: 'button', className: 'rbf-btn', disabled: running, onClick: () => run(true) }, '生成并写入工作区'),
          ]),
        ]),
        error !== null ? h(Notice, { key: 'error', tone: 'red' }, error) : null,
        result !== null ? h('div', { key: 'result', className: 'rbf-panel' }, [
          h('div', { key: 'head', className: 'rbf-section-head' }, [
            h('h3', { key: 't' }, result.ok ? '脚本已生成' : '生成失败'),
            result.written && result.paths?.length > 0 ? h('span', { key: 'path', className: 'rbf-mono' }, result.paths.join(', ')) : h('span', { key: 'nowrite', className: 'rbf-muted' }, result.written ? '' : '尚未写入工作区'),
          ]),
          h(Diagnostics, { key: 'diag', items: result.diagnostics, emptyText: '没有诊断。' }),
          (result.warnings ?? []).length > 0 ? h('div', { key: 'warnings', className: 'rbf-card' }, [
            h('div', { key: 'l', className: 'rbf-label' }, '警告'),
            h('ul', { key: 'ul', className: 'rbf-list' }, result.warnings.map((warning, index) => h('li', { key: index }, `[${warning.code ?? 'warning'}] ${warning.message}`))),
          ]) : null,
          result.artifacts?.map((artifact) => h('div', { key: artifact.name }, [
            h('div', { key: 'label', className: 'rbf-label' }, `${artifact.role} · ${artifact.name}`),
            h('pre', { key: 'pre', className: 'rbf-pre' }, artifact.script),
          ])),
        ]) : null,
      ])
    }

    function ValidateTab({ state, setBusy }) {
      const [source, setSource] = useState('text')
      const [script, setScript] = useState('data <- readDiscreteCharacterData("data/dna.nex")\nQ <- fnJC(4)\nmymodel = model(Q)\nmymcmc = mcmc(model=mymodel, monitors=VectorMonitors(), moves=VectorMoves())\nmymcmc.run(generations=100)\nq()\n')
      const [path, setPath] = useState('scripts/revbayes_forge.Rev')
      const [mode, setMode] = useState('static')
      const [strict, setStrict] = useState(false)
      const [applyFixes, setApplyFixes] = useState(false)
      const [result, setResult] = useState(null)
      const [error, setError] = useState(null)
      const [running, setRunning] = useState(false)

      const run = async () => {
        setError(null)
        setResult(null)
        setRunning(true)
        setBusy(true)
        try {
          const value = await request('/validate', {
            method: 'POST',
            body: {
              ...(source === 'text' ? { script } : { path }),
              mode,
              ...(strict ? { strict: true } : {}),
              ...(applyFixes ? { applyFixes: true } : {}),
            },
          })
          setResult(value.result)
        } catch (requestError) {
          setError(`${requestError.code ? `${requestError.code}: ` : ''}${requestError.message}${requestError.path ? `（${requestError.path}）` : ''}`)
        } finally {
          setRunning(false)
          setBusy(false)
        }
      }

      const runtime = result?.runtime
      return h('div', { className: 'rbf-panel' }, [
        h('div', { key: 'form', className: 'rbf-card', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, [
          h('div', { key: 'source', className: 'rbf-tabs', style: { marginBottom: 0, alignSelf: 'flex-start' } }, [
            h('button', { key: 'text', type: 'button', className: 'rbf-tab', 'aria-selected': source === 'text', onClick: () => setSource('text') }, '脚本文本'),
            h('button', { key: 'path', type: 'button', className: 'rbf-tab', 'aria-selected': source === 'path', onClick: () => setSource('path') }, '脚本路径'),
          ]),
          source === 'text'
            ? h('label', { key: 'script', className: 'rbf-field' }, [
                h('span', { key: 'l' }, 'RevBayes 脚本'),
                h('textarea', { key: 'ta', className: 'rbf-textarea', spellCheck: false, value: script, onChange: (event) => setScript(event.target.value) }),
              ])
            : h('label', { key: 'path', className: 'rbf-field' }, [
                h('span', { key: 'l' }, '脚本路径（相对工作区或绝对路径）'),
                h('input', { key: 'i', className: 'rbf-input', value: path, onChange: (event) => setPath(event.target.value) }),
              ]),
          h('div', { key: 'row', className: 'rbf-row' }, [
            h('label', { key: 'mode', className: 'rbf-field' }, [
              h('span', { key: 'l' }, '校验模式'),
              h('select', { key: 's', className: 'rbf-select', value: mode, onChange: (event) => setMode(event.target.value) }, [
                h('option', { key: 'static', value: 'static' }, 'static — 仅静态检查'),
                h('option', { key: 'dry', value: 'dry' }, 'dry — 执行到 MCMC 前'),
                h('option', { key: 'smoke', value: 'smoke' }, 'smoke — 短程 MCMC'),
              ]),
            ]),
            h('label', { key: 'strict', className: 'rbf-inline', style: { paddingBottom: '8px' } }, [
              h('input', { key: 'c', type: 'checkbox', checked: strict, onChange: (event) => setStrict(event.target.checked) }),
              h('span', { key: 't' }, '严格模式'),
            ]),
            h('label', { key: 'fix', className: 'rbf-inline', style: { paddingBottom: '8px' } }, [
              h('input', { key: 'c', type: 'checkbox', checked: applyFixes, onChange: (event) => setApplyFixes(event.target.checked) }),
              h('span', { key: 't' }, '应用安全修复'),
            ]),
          ]),
          mode !== 'static' && !state.revbayes.found ? h(Notice, { key: 'rb', tone: 'warn' }, 'dry / smoke 需要 RevBayes。可先在 Environment 页检测或配置 rb 路径。') : null,
          h('div', { key: 'actions', className: 'rbf-actions' }, [
            h('button', { key: 'run', type: 'button', className: 'rbf-btn primary', disabled: running, onClick: run }, running ? '校验中…' : '开始校验'),
          ]),
        ]),
        error !== null ? h(Notice, { key: 'error', tone: 'red' }, error) : null,
        result !== null ? h('div', { key: 'result', className: 'rbf-panel' }, [
          h('div', { key: 'head', className: 'rbf-section-head' }, [
            h('h3', { key: 't' }, result.ok ? '校验通过' : '校验未通过'),
            h('span', { key: 'target', className: 'rbf-mono' }, result.target?.path ?? '内联脚本'),
          ]),
          h('div', { key: 'summary', className: 'rbf-grid' }, [
            h('div', { key: 'static', className: 'rbf-card' }, [
              h('div', { key: 'l', className: 'rbf-card-label' }, '静态检查'),
              h('div', { key: 'v', className: 'rbf-card-value' }, `${result.static?.summary?.error ?? 0} / ${result.static?.summary?.warning ?? 0}`),
              h('div', { key: 'n', className: 'rbf-card-note' }, 'errors / warnings'),
            ]),
            h('div', { key: 'runtime', className: 'rbf-card' }, [
              h('div', { key: 'l', className: 'rbf-card-label' }, '运行期'),
              h('div', { key: 'v', className: 'rbf-card-value' }, runtime?.attempted ? (runtime.ok ? '通过' : '失败') : (runtime?.requested ? '未执行' : '未请求')),
              h('div', { key: 'n', className: 'rbf-card-note' }, runtime?.attempted ? `${runtime.mode} · ${runtime.duration_ms ?? '?'} ms` : (runtime?.skipped_reason ?? `模式 ${mode}`)),
            ]),
          ]),
          h(Diagnostics, { key: 'diag', items: result.diagnostics, emptyText: '没有诊断。' }),
          result.fixes?.applied?.length > 0 ? h(Notice, { key: 'fixes', tone: 'green' }, `已应用 ${result.fixes.applied.length} 个安全修复；跳过 ${result.fixes.skipped?.length ?? 0} 个需人工确认的修复。`) : null,
          result.fixed_script !== undefined ? h('div', { key: 'fixed' }, [
            h('div', { key: 'l', className: 'rbf-label' }, '修复后的脚本'),
            h('pre', { key: 'pre', className: 'rbf-pre' }, result.fixed_script),
          ]) : null,
        ]) : null,
      ])
    }

    function RevBayesSettingsPage() {
      const [tab, setTab] = useState('overview')
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const value = await request('/state')
          setState(value)
        } catch (loadError) {
          setError(loadError.code ? `${loadError.code}: ${loadError.message}` : loadError.message)
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const tabs = [
        { id: 'overview', label: '总览' },
        { id: 'packs', label: 'Packs' },
        { id: 'environment', label: 'Environment' },
        { id: 'generate', label: 'Generate' },
        { id: 'validate', label: 'Validate' },
      ]

      return h('div', { className: 'rbf-page' }, [
        h('style', { key: 'style' }, CSS),
        h('h2', { key: 'title', className: 'rbf-title' }, 'RevBayes Forge'),
        h('p', { key: 'subtitle', className: 'rbf-subtitle' }, '统一管理 13 个模型包、RevBayes 运行时与脚本生成/校验。'),
        h('div', { key: 'tabs', className: 'rbf-tabs', role: 'tablist' }, tabs.map((item) => h('button', {
          key: item.id,
          type: 'button',
          role: 'tab',
          className: 'rbf-tab',
          'aria-selected': tab === item.id,
          onClick: () => setTab(item.id),
        }, item.label))),
        state === null && error === null ? h('div', { key: 'loading', className: 'rbf-loading' }, '正在读取 RevBayes Forge 状态…') : null,
        state === null && error !== null ? h('div', { key: 'error', className: 'rbf-panel' }, [
          h(Notice, { key: 'n', tone: 'red' }, error),
          h('div', { key: 'a', className: 'rbf-actions' }, [h('button', { key: 'r', type: 'button', className: 'rbf-btn primary', onClick: load }, '重试')]),
        ]) : null,
        state !== null && tab === 'overview' ? h(Overview, { key: 'overview', state, onRefresh: load, busy }) : null,
        state !== null && tab === 'packs' ? h(PacksTab, { key: 'packs', state, onStateChange: setState, onRefresh: load, busy }) : null,
        state !== null && tab === 'environment' ? h(EnvironmentTab, { key: 'environment', state, onStateChange: setState, busy, setBusy }) : null,
        state !== null && tab === 'generate' ? h(GenerateTab, { key: 'generate', state, setBusy }) : null,
        state !== null && tab === 'validate' ? h(ValidateTab, { key: 'validate', state, setBusy }) : null,
      ])
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'revbayes-forge',
          order: 20,
          label: () => 'RevBayes Forge',
          locale: NS,
        }, RevBayesSettingsPage)),
        'revbayes-forge: settings section',
      )
    }

    return {
      name: 'revbayes-forge',
      inject,
      apply,
      __test: { sampleFor, SAMPLE_SPECS },
    }
  },
})
