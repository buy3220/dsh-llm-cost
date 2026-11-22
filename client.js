window.__ModuleLoader__.load({
  id: 'dsh-llm-cost',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    const NS = 'llmCost'

    const zh = {
      'pill.total': '累计 {cost}',
      'pill.turn': '本轮 {cost}',
      'pill.label': '累计 {total}，本轮 {turn}',
      'dialog.title': '对话消费',
      'dialog.turn': '本轮 #{turn}',
      'dialog.total': '本对话累计',
      'dialog.tokens': '{count} tok',
      'row.cost': '消费',
      'row.input': '输入（未缓存）',
      'row.cacheRead': '缓存读取',
      'row.cacheWrite': '缓存写入',
      'row.output': '输出',
      'row.cacheHit': '缓存命中率',
      'row.detail': '计价明细',
      'row.unpriced': '未配置价格',
      'row.inferred': '含推定归属 {count} 次',
      'row.compaction': '压缩摘要',
      'row.partialCost': '+ 表示部分调用未配置价格，金额仅含已定价部分。',
      'period.off': '空闲',
      'period.peak': '高峰',
      'tier.short': '短上下文',
      'tier.long': '长上下文',
      'page.title': '对话计费',
      'page.showPills': '在对话中显示消费',
      'page.showPillsHint': '关闭后底部胶囊与每轮读数立即隐藏，内置 token 用量胶囊不受影响。',
      'page.showPerTurn': '每轮回复下方显示本轮消费',
      'page.rules': '计费规则',
      'page.source': '来源',
      'page.fetched': '抓取时间',
      'page.status': '状态',
      'page.status.ok': '正常',
      'page.status.stale': '可能过期',
      'page.refresh': '从官网更新计费规则',
      'page.refreshing': '正在更新…',
      'page.reset': '恢复内置默认价表',
      'page.last': '上次更新结果',
      'page.table': '当前生效价表',
      'page.note': 'DeepSeek 按官网人民币价计费，不做汇率折算；Grok 按美元价 × {fx} 折算。金额保留 6 位小数，第 7 位四舍五入，去尾零。',
      'page.busy': '更新中，请稍候',
      'page.failed': '更新失败',
      'page.ok': '更新成功',
      'page.partial': '部分更新',
      'page.mismatch': '计费规则不匹配',
      'page.mismatchHint': '官网计价结构已变化，已保留原价表；需要更新插件代码后才能适配。',
      'page.error': '更新失败',
      'page.busyReturn': '正在更新，请稍候',
      'page.resetDone': '已恢复内置价表',
      'unit.perMillion': '每百万 tokens',
      'num.count': '{count}',
    }

    const en = {
      'pill.total': 'Total {cost}',
      'pill.turn': 'Turn {cost}',
      'pill.label': 'Total {total}, this turn {turn}',
      'dialog.title': 'Conversation cost',
      'dialog.turn': 'Turn #{turn}',
      'dialog.total': 'Conversation total',
      'dialog.tokens': '{count} tok',
      'row.cost': 'Cost',
      'row.input': 'Uncached input',
      'row.cacheRead': 'Cached input',
      'row.cacheWrite': 'Cache write',
      'row.output': 'Output',
      'row.cacheHit': 'Cache hit',
      'row.detail': 'Priced segments',
      'row.unpriced': 'No price',
      'row.inferred': '{count} attributed by inference',
      'row.compaction': 'Compaction',
      'row.partialCost': '+ means some calls have no configured price; the amount covers priced calls only.',
      'period.off': 'off-peak',
      'period.peak': 'peak',
      'tier.short': 'short context',
      'tier.long': 'long context',
      'page.title': 'Conversation cost',
      'page.showPills': 'Show cost in conversations',
      'page.showPillsHint': 'Hiding removes the dock pill and per-turn reading; the built-in token pill stays untouched.',
      'page.showPerTurn': 'Show a per-turn cost line under each reply',
      'page.rules': 'Pricing rules',
      'page.source': 'Source',
      'page.fetched': 'Fetched',
      'page.status': 'Status',
      'page.status.ok': 'current',
      'page.status.stale': 'possibly stale',
      'page.refresh': 'Update pricing from the official pages',
      'page.refreshing': 'Updating…',
      'page.reset': 'Restore built-in table',
      'page.last': 'Last update result',
      'page.table': 'Active price table',
      'page.note': 'DeepSeek is billed at its official CNY prices with no FX conversion; Grok is converted at {fx} CNY per USD. Amounts keep six decimals, rounded half up, trailing zeros trimmed.',
      'page.busy': 'Update in progress',
      'page.failed': 'Update failed',
      'page.ok': 'Updated',
      'page.partial': 'Partly updated',
      'page.mismatch': 'Pricing framework mismatch',
      'page.mismatchHint': 'The official page structure changed; the previous table stays active until the plugin code is updated.',
      'page.error': 'Update failed',
      'page.busyReturn': 'An update is already running',
      'page.resetDone': 'Built-in table restored',
      'unit.perMillion': 'per 1M tokens',
      'num.count': '{count}',
    }

    // ---- shared client store -------------------------------------------------

    const initial = {
      loaded: false,
      showPills: true,
      showPerTurn: false,
      meta: null,
      lastRefresh: null,
      table: null,
      fx: 6.7,
    }
    let store = initial
    const listeners = new Set()
    const subscribe = (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }
    const getSnapshot = () => store
    const setStore = (patch) => {
      store = { ...store, ...patch }
      for (const fn of [...listeners]) fn()
    }
    const useStore = () => React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    /** Locale seat: the slot injects `t` for our namespace; keep a fallback. */
    let boundT = null
    const pickT = (props) => (typeof props.t === 'function' ? props.t : (boundT ?? ((key) => key)))

    async function loadState() {
      try {
        const response = await fetch('/plugins/llm-cost/state', { headers: { accept: 'application/json' } })
        const body = await response.json()
        if (body && body.ok) {
          setStore({
            loaded: true,
            showPills: body.showPills !== false,
            showPerTurn: body.showPerTurn === true,
            meta: body.meta ?? null,
            lastRefresh: body.lastRefresh ?? null,
            table: body.table ?? null,
            fx: typeof body.fx === 'number' ? body.fx : 6.7,
          })
        }
      } catch {
        // A missing endpoint (host half disabled) simply leaves the pill hidden.
      }
    }

    async function postJson(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return await response.json()
    }

    function applyState(body) {
      if (!body || !body.ok) return null
      setStore({
        loaded: true,
        showPills: body.showPills !== false,
        showPerTurn: body.showPerTurn === true,
        meta: body.meta ?? store.meta,
        lastRefresh: body.lastRefresh ?? store.lastRefresh,
        table: body.table ?? store.table,
        fx: typeof body.fx === 'number' ? body.fx : store.fx,
      })
      return body
    }

    // ---- formatting ---------------------------------------------------------

    function money(value) {
      if (!value || typeof value.cost !== 'string') return '￥—'
      const amount = value.tiny ? '￥<0.000001' : `￥${value.cost}`
      if (value.complete === false) return value.priced ? `${amount}+` : '￥—'
      return amount
    }

    function grouped(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '0'
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    function cacheHit(tokens) {
      const prompt = (tokens.input || 0) + (tokens.cacheRead || 0) + (tokens.cacheWrite || 0)
      if (prompt <= 0) return null
      if ((tokens.cacheRead || 0) === prompt) return '100'
      const percent = ((tokens.cacheRead || 0) / prompt) * 100
      if (percent >= 99.95) {
        return (Math.floor(percent * 1000000) / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
      }
      return percent.toFixed(1)
    }

    function dimensionTag(group, t) {
      if (group.period) return t(`period.${group.period}`)
      if (group.tier) return t(`tier.${group.tier}`)
      return ''
    }

    // ---- dialog dismissal ---------------------------------------------------

    function useDismiss(rootRef, panelRef, open, setOpen) {
      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onClick = (event) => {
          const target = event.target
          if (!(target instanceof Node)) return
          if (rootRef.current && rootRef.current.contains(target)) return
          if (panelRef.current && panelRef.current.contains(target)) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('click', onClick, true)
        }
      }, [open, setOpen, rootRef, panelRef])
    }

    // ---- dialog body --------------------------------------------------------

    function Row({ label, value }) {
      return h(React.Fragment, null,
        h('dt', null, label),
        h('dd', null, value))
    }

    function Section({ title, cost, tokens, groups, inferred, complete = true, t }) {
      const hit = cacheHit(tokens)
      return h('div', { className: 'dsh-llm-cost-section' },
        h('div', { className: 'dsh-llm-cost-sectionHead' },
          h('span', null, title),
          h('span', { className: 'dsh-llm-cost-sectionCost' }, cost)),
        h('dl', { className: 'dsh-llm-cost-rows' },
          h(Row, { label: t('row.input'), value: t('dialog.tokens', { count: grouped(tokens.input) }) }),
          h(Row, { label: t('row.cacheRead'), value: t('dialog.tokens', { count: grouped(tokens.cacheRead) }) }),
          tokens.cacheWrite > 0
            ? h(Row, { label: t('row.cacheWrite'), value: t('dialog.tokens', { count: grouped(tokens.cacheWrite) }) })
            : null,
          h(Row, { label: t('row.output'), value: t('dialog.tokens', { count: grouped(tokens.output) }) }),
          hit === null ? null : h(Row, { label: t('row.cacheHit'), value: `${hit}%` })),
        groups && groups.length > 0
          ? h('div', { className: 'dsh-llm-cost-groups' },
            groups.map((group, index) => h('div', { className: 'dsh-llm-cost-group', key: `${group.provider}-${group.model}-${index}` },
              h('span', { className: 'dsh-llm-cost-groupName' },
                `${group.provider || '?'}/${group.model || '?'}`,
                group.kind === 'compaction' ? ` · ${t('row.compaction')}` : '',
                group.period || group.tier ? ` · ${dimensionTag(group, t)}` : '',
                ` ×${group.calls}`),
              h('span', { className: 'dsh-llm-cost-groupCost' }, group.priced ? money(group) : t('row.unpriced')))))
          : null,
        inferred > 0 ? h('div', { className: 'dsh-llm-cost-note' }, t('row.inferred', { count: inferred })) : null,
        complete === false ? h('div', { className: 'dsh-llm-cost-note' }, t('row.partialCost')) : null)
    }

    function CostDialog({ view, position, panelRef, t }) {
      const turn = view.turns[String(view.lastTurn)]
      return h('div', {
        ref: panelRef,
        className: 'dsh-llm-cost-panel',
        role: 'dialog',
        'aria-label': t('dialog.title'),
        'data-llm-cost-dialog': '',
        style: position === null
          ? { left: 0, top: 0, visibility: 'hidden' }
          : { left: `${position.left}px`, top: `${position.top}px` },
      },
      h('div', { className: 'dsh-llm-cost-title' },
        h('span', null, t('dialog.title')),
        h('span', { className: 'dsh-llm-cost-titleValue' }, money(view.total))),
      h('div', { className: 'dsh-llm-cost-rule' }),
      turn
        ? h(Section, {
          title: t('dialog.turn', { turn: turn.turn }),
          cost: money(turn),
          tokens: turn.tokens,
          groups: turn.groups,
          inferred: turn.inferred ?? 0,
          complete: turn.complete !== false,
          t,
        })
        : null,
      h(Section, {
        title: t('dialog.total'),
        cost: money(view.total),
        tokens: view.total.tokens,
        groups: view.total.groups ?? [],
        inferred: 0,
        complete: view.total.complete !== false,
        t,
      }),
      view.unpriced && view.unpriced.length > 0
        ? h('div', { className: 'dsh-llm-cost-note' }, `${t('row.unpriced')}：${view.unpriced.join('、')}`)
        : null)
    }

    // ---- dock pill ----------------------------------------------------------

    function CostPill(props) {
      const t = pickT(props)
      const state = useStore()
      const view = props.useProjection('llmCost')
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const [position, setPosition] = React.useState(null)
      useDismiss(rootRef, panelRef, open, setOpen)

      // Place the panel from the trigger's own rectangle: above the pill when
      // there is room, otherwise below it, always inside a 12px viewport inset.
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return undefined
        }
        const place = () => {
          const trigger = rootRef.current
          const panel = panelRef.current
          if (!trigger) return
          const rect = trigger.getBoundingClientRect()
          const width = panel ? panel.offsetWidth : Math.min(440, window.innerWidth - 24)
          const height = panel ? panel.offsetHeight : 0
          const margin = 12
          const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin))
          let top = rect.top - 8 - height
          if (top < margin) top = Math.min(window.innerHeight - height - margin, rect.bottom + 8)
          setPosition({ left: Math.max(margin, left), top: Math.max(margin, top) })
        }
        place()
        window.addEventListener('resize', place)
        return () => { window.removeEventListener('resize', place) }
      }, [open])

      if (!state.showPills) return null
      if (!view || !view.ready) return null
      const turn = view.turns[String(view.lastTurn)]
      const totalText = money(view.total)
      const turnText = turn ? money(turn) : null
      const label = t('pill.label', { total: totalText, turn: turnText ?? '—' })

      return h('span', { ref: rootRef, className: 'dsh-llm-cost-anchor', 'data-llm-cost-pill': '' },
        h('button', {
          type: 'button',
          className: 'dsh-llm-cost-pill',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': label,
          title: label,
          onClick: () => setOpen(!open),
        },
        h('span', { className: 'dsh-llm-cost-label' }, t('pill.total', { cost: totalText })),
        turnText === null ? null : h('span', { className: 'dsh-llm-cost-sep', 'aria-hidden': true }, '·'),
        turnText === null ? null : h('span', { className: 'dsh-llm-cost-label dsh-llm-cost-turn' }, t('pill.turn', { cost: turnText }))),
        open ? createPortal(h(CostDialog, { view, position, panelRef, t }), document.body) : null)
    }

    // ---- per-turn line ------------------------------------------------------

    function PerTurnLine(props) {
      const t = pickT(props)
      const state = useStore()
      const view = props.useProjection('llmCost')
      if (!state.showPills || !state.showPerTurn) return null
      if (!view || !view.ready) return null
      const key = typeof props.turn === 'number' ? String(props.turn) : String(view.lastTurn)
      const turn = view.turns[key]
      if (!turn) return null
      return h('div', { className: 'dsh-llm-cost-perTurn', 'data-llm-cost-turn': key },
        h('span', null, t('pill.turn', { cost: money(turn) })))
    }

    // ---- settings page ------------------------------------------------------

    function Switch({ checked, onChange, label, hint, testId }) {
      return h('div', { className: 'dsh-llm-cost-switchRow' },
        h('div', { className: 'dsh-llm-cost-switchText' },
          h('div', { className: 'dsh-llm-cost-switchLabel' }, label),
          hint ? h('div', { className: 'dsh-llm-cost-switchHint' }, hint) : null),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          'data-llm-cost-switch': testId,
          className: `dsh-llm-cost-switch${checked ? ' is-on' : ''}`,
          onClick: () => onChange(!checked),
        }, h('span', { className: 'dsh-llm-cost-switchThumb' })))
    }

    function SettingsPage(props) {
      const t = pickT(props)
      const state = useStore()
      const [busy, setBusy] = React.useState(false)
      const [banner, setBanner] = React.useState(null)

      React.useEffect(() => { void loadState() }, [])

      const setFlag = async (patch) => {
        setStore({ ...patch })
        try {
          applyState(await postJson('/plugins/llm-cost/settings', patch))
        } catch {
          // Keep the optimistic value; the next load restores the host truth.
        }
      }

      const refresh = async () => {
        if (busy) return
        setBusy(true)
        setBanner(null)
        try {
          const body = await postJson('/plugins/llm-cost/refresh', {})
          applyState(body)
          setBanner({ status: body.status, message: body.message })
        } catch (error) {
          setBanner({ status: 'error', message: String(error && error.message ? error.message : error) })
        } finally {
          setBusy(false)
        }
      }

      const reset = async () => {
        if (busy) return
        setBusy(true)
        try {
          const body = await postJson('/plugins/llm-cost/reset', {})
          applyState(body)
          setBanner({ status: 'reset', message: t('page.resetDone') })
        } catch (error) {
          setBanner({ status: 'error', message: String(error && error.message ? error.message : error) })
        } finally {
          setBusy(false)
        }
      }

      const stale = state.meta && state.meta.stale === true
      const fetched = state.meta && state.meta.fetchedAt
        ? new Date(state.meta.fetchedAt).toLocaleString()
        : '—'
      const statusText = state.meta
        ? (stale ? t('page.status.stale') : t('page.status.ok'))
        : '—'

      const bannerTone = banner === null
        ? null
        : banner.status === 'ok' || banner.status === 'reset'
          ? 'ok'
          : banner.status === 'partial'
            ? 'warn'
            : 'bad'
      const bannerTitle = banner === null
        ? ''
        : banner.status === 'ok'
          ? t('page.ok')
          : banner.status === 'partial'
            ? t('page.partial')
            : banner.status === 'reset'
              ? t('page.resetDone')
              : banner.status === 'mismatch'
                ? t('page.mismatch')
                : t('page.error')

      return h('div', { className: 'dsh-llm-cost-page' },
        h('h2', { className: 'dsh-llm-cost-pageTitle' }, t('page.rules')),
        h(Switch, {
          checked: state.showPills,
          onChange: (next) => { void setFlag({ showPills: next }) },
          label: t('page.showPills'),
          hint: t('page.showPillsHint'),
          testId: 'pills',
        }),
        h(Switch, {
          checked: state.showPerTurn,
          onChange: (next) => { void setFlag({ showPerTurn: next }) },
          label: t('page.showPerTurn'),
          testId: 'perTurn',
        }),
        h('div', { className: 'dsh-llm-cost-meta' },
          h('div', null, h('span', { className: 'dsh-llm-cost-metaKey' }, t('page.source')), ' ', state.meta && state.meta.source === 'web' ? 'deepseek.com / x.ai' : 'built-in'),
          h('div', null, h('span', { className: 'dsh-llm-cost-metaKey' }, t('page.fetched')), ' ', fetched),
          h('div', null, h('span', { className: 'dsh-llm-cost-metaKey' }, t('page.status')), ' ', statusText)),
        h('div', { className: 'dsh-llm-cost-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-llm-cost-primary',
            disabled: busy,
            'data-llm-cost-action': 'refresh',
            onClick: () => { void refresh() },
          }, busy ? t('page.refreshing') : t('page.refresh')),
          h('button', {
            type: 'button',
            className: 'dsh-llm-cost-secondary',
            disabled: busy,
            'data-llm-cost-action': 'reset',
            onClick: () => { void reset() },
          }, t('page.reset'))),
        banner === null
          ? null
          : h('div', { className: `dsh-llm-cost-banner is-${bannerTone}`, 'data-llm-cost-banner': banner.status },
            h('div', { className: 'dsh-llm-cost-bannerTitle' }, bannerTitle),
            h('div', { className: 'dsh-llm-cost-bannerBody' }, banner.message ?? ''),
            banner.status === 'mismatch' ? h('div', { className: 'dsh-llm-cost-bannerHint' }, t('page.mismatchHint')) : null),
        state.lastRefresh && banner === null
          ? h('div', { className: 'dsh-llm-cost-last' },
            `${t('page.last')}：${state.lastRefresh.status} · ${state.lastRefresh.message ?? ''}`)
          : null,
        h('p', { className: 'dsh-llm-cost-noteLine' }, t('page.note', { fx: String(state.fx) })),
        h('h3', { className: 'dsh-llm-cost-subTitle' }, t('page.table')),
        h('div', { className: 'dsh-llm-cost-table' },
          (state.table ?? []).map((entry) => h('div', { className: 'dsh-llm-cost-tableRow', key: `${entry.vendor}-${entry.model}` },
            h('div', { className: 'dsh-llm-cost-tableHead' }, `${entry.vendor} / ${entry.model}`),
            h('div', { className: 'dsh-llm-cost-tableMoney' }, entry.lines.join('　'))))),
        h('p', { className: 'dsh-llm-cost-noteLine' }, t('unit.perMillion')))
    }

    // ---- styles -------------------------------------------------------------

    const CSS = `
.dsh-llm-cost-anchor{display:inline-flex;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));}
.dsh-llm-cost-pill{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;max-width:100%;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer;}
.dsh-llm-cost-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}
@media (hover:hover){.dsh-llm-cost-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}}
.dsh-llm-cost-sign{font-variant-numeric:tabular-nums;}
.dsh-llm-cost-label{min-width:0;overflow:hidden;text-overflow:ellipsis;}
.dsh-llm-cost-sep{color:var(--dsw-alias-separator-primary);margin:0 2px;}
@media (max-width:520px){.dsh-llm-cost-turn,.dsh-llm-cost-pill .dsh-llm-cost-sep{display:none;}}
.dsh-llm-cost-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));padding:16px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:default;max-height:calc(100dvh - 36px);overflow-x:hidden;overflow-y:auto;margin:0;}
.dsh-llm-cost-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500;}
.dsh-llm-cost-titleValue{font-variant-numeric:tabular-nums;}
.dsh-llm-cost-rule{margin-bottom:10px;border-top:0.5px solid var(--dsw-alias-border-l2);}
.dsh-llm-cost-section{margin-bottom:12px;}
.dsh-llm-cost-sectionHead{display:flex;justify-content:space-between;gap:16px;margin-bottom:6px;color:var(--dsw-alias-label-secondary);font-weight:500;}
.dsh-llm-cost-sectionCost{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);}
.dsh-llm-cost-rows{display:grid;grid-template-columns:minmax(84px,auto) minmax(0,1fr);gap:4px 16px;margin:0;color:var(--dsw-alias-label-tertiary);}
.dsh-llm-cost-rows dt,.dsh-llm-cost-rows dd{min-width:0;margin:0;}
.dsh-llm-cost-rows dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;}
.dsh-llm-cost-groups{margin-top:8px;border-top:0.5px solid var(--dsw-alias-border-l2);padding-top:6px;display:grid;gap:4px;}
.dsh-llm-cost-group{display:flex;justify-content:space-between;gap:12px;color:var(--dsw-alias-label-tertiary);}
.dsh-llm-cost-groupName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dsh-llm-cost-groupCost{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.dsh-llm-cost-note{margin-top:6px;color:var(--dsw-alias-label-tertiary);}
.dsh-llm-cost-perTurn{display:flex;align-items:center;gap:2px;color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:20px;}
.dsh-llm-cost-page{display:flex;flex-direction:column;gap:12px;padding:8px 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;max-width:640px;}
.dsh-llm-cost-pageTitle{margin:0;font-size:15px;line-height:24px;color:var(--dsw-alias-label-primary);font-weight:600;}
.dsh-llm-cost-subTitle{margin:8px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);font-weight:600;}
.dsh-llm-cost-switchRow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:8px 0;border-top:0.5px solid var(--dsw-alias-border-l2);}
.dsh-llm-cost-switchText{min-width:0;}
.dsh-llm-cost-switchLabel{color:var(--dsw-alias-label-primary);}
.dsh-llm-cost-switchHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}
.dsh-llm-cost-switch{position:relative;flex:none;width:36px;height:20px;margin-top:2px;border:none;border-radius:999px;background:var(--dsw-alias-fill-l2,#d9d9d9);cursor:pointer;transition:background .15s ease;}
.dsh-llm-cost-switch.is-on{background:var(--dsw-alias-brand-fill,#3b82f6);}
.dsh-llm-cost-switchThumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:var(--dsw-alias-fill-inverse,#fff);transition:transform .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.2);}
.dsh-llm-cost-switch.is-on .dsh-llm-cost-switchThumb{transform:translateX(16px);}
.dsh-llm-cost-meta{display:grid;gap:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}
.dsh-llm-cost-metaKey{color:var(--dsw-alias-label-tertiary);}
.dsh-llm-cost-actions{display:flex;gap:8px;flex-wrap:wrap;}
.dsh-llm-cost-primary,.dsh-llm-cost-secondary{font:inherit;font-size:12px;line-height:20px;padding:4px 12px;border-radius:var(--dsw-radius-sm);cursor:pointer;border:0.5px solid var(--dsw-alias-border-l2);}
.dsh-llm-cost-primary{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dsh-llm-cost-secondary{background:transparent;color:var(--dsw-alias-label-secondary);}
.dsh-llm-cost-primary:disabled,.dsh-llm-cost-secondary:disabled{opacity:.5;cursor:default;}
.dsh-llm-cost-banner{padding:8px 10px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);}
.dsh-llm-cost-banner.is-bad{border-color:var(--dsw-alias-state-error,#d9534f);}
.dsh-llm-cost-bannerTitle{font-weight:600;color:var(--dsw-alias-label-primary);}
.dsh-llm-cost-bannerBody{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}
.dsh-llm-cost-bannerHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:2px;}
.dsh-llm-cost-last{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}
.dsh-llm-cost-noteLine{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}
.dsh-llm-cost-table{display:grid;gap:6px;}
.dsh-llm-cost-tableRow{padding:6px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);}
.dsh-llm-cost-tableHead{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;}
.dsh-llm-cost-tableMoney{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;}
`

    // ---- plugin -------------------------------------------------------------

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        boundT = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-cost locale')

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshLlmCost = ''
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'llm-cost styles')

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'llm-cost',
          order: 2,
          locale: NS,
        }, CostPill))

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'llm-cost-turn',
          order: 4,
          locale: NS,
        }, PerTurnLine))

        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'llm-cost',
          order: 20,
          locale: NS,
          label: () => ctx.locale.bind(NS)('page.title'),
        }, SettingsPage))

        void loadState()
      },
    }
  },
})
