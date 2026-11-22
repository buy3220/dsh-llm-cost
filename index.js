/**
 * Host half of the conversation-cost plugin.
 *
 * Owns three things: the `llmCost` session projection (exact per-turn token
 * buckets plus CNY cost, computed from the durable log), the persisted rate
 * table, and the endpoints the browser half uses to read state and refresh
 * pricing from the two official pages.
 *
 * The built-in token-usage pill is never touched; the Client half adds a
 * separate pill beside it.
 */

import { BUILTIN_TABLE, DEFAULT_FX } from './lib/table.js'
import { createProjection } from './lib/projection.js'
import { refreshComputedTable } from './lib/fetch-rules.js'
import { readState, statePath, writeState } from './lib/store.js'
import { registerRoutes, summarizeTable } from './lib/routes.js'

/** Cordis plugin name. */
export const name = 'llm-cost'

/** Projections compute the numbers; the web server carries the plugin page. */
export const inject = ['sessionProjections', 'webServer']

/** Compare one price bucket across tables to flag a surprising jump. */
function bucketJump(previous, next) {
  const pairs = [
    [previous?.vendors?.deepseek?.models?.['deepseek-flash']?.miss?.off, next?.vendors?.deepseek?.models?.['deepseek-flash']?.miss?.off],
    [previous?.vendors?.xai?.models?.['grok-4.3']?.tiers?.[0]?.input, next?.vendors?.xai?.models?.['grok-4.3']?.tiers?.[0]?.input],
  ]
  for (const [before, after] of pairs) {
    if (typeof before !== 'number' || typeof after !== 'number' || before <= 0) continue
    const ratio = after / before
    if (ratio > 1.5 || ratio < 1 / 1.5) return true
  }
  return false
}

/** Keep only the small part of a refresh detail record. */
function detailDigest(detail) {
  if (!detail) return undefined
  const pick = (entry) => ({
    status: entry?.status ?? 'unknown',
    message: entry?.message,
    url: entry?.url,
    models: entry?.models ? Object.keys(entry.models) : undefined,
  })
  return { deepseek: pick(detail.deepseek), xai: pick(detail.xai), tookMs: detail.tookMs }
}

/**
 * Activate the plugin.
 * @param ctx - plugin context with `sessionProjections` and `webServer`.
 * @param config - optional row config from `cordis.patch.yml`.
 */
export async function apply(ctx, config = {}) {
  const fx = Number(config.fxRateCnyPerUsd) > 0 ? Number(config.fxRateCnyPerUsd) : DEFAULT_FX
  const timeoutMs = Number(config.fetchTimeoutMs) > 0 ? Number(config.fetchTimeoutMs) : 8000
  const attempts = Math.max(1, Number(config.fetchAttempts) || 3)
  const path = statePath(config)
  const saved = await readState(path)
  const savedVersion = Number(saved?.table?.version)
  const useSavedTable = saved?.table?.vendors
    && Number.isFinite(savedVersion)
    && savedVersion >= BUILTIN_TABLE.version

  const runtime = {
    table: useSavedTable ? saved.table : BUILTIN_TABLE,
    fx,
    rev: 0,
    meta: useSavedTable
      ? saved?.meta ?? { source: 'web', fetchedAt: saved.table.fetchedAt ?? null, stale: true }
      : { source: 'builtin', fetchedAt: BUILTIN_TABLE.fetchedAt, stale: true },
  }
  const settings = {
    showPills: saved?.showPills !== false,
    showPerTurn: saved?.showPerTurn === true,
  }
  let lastRefresh = saved?.lastRefresh ?? null
  let refreshing = false

  let handle = await ctx.sessionProjections.register(createProjection(runtime))
  ctx.effect(() => () => { void handle.dispose() }, 'llm-cost projection')

  const persist = async () => {
    await writeState(path, {
      showPills: settings.showPills,
      showPerTurn: settings.showPerTurn,
      table: runtime.table,
      meta: { ...runtime.meta, detail: undefined },
      lastRefresh,
    })
  }

  const restart = async () => {
    runtime.rev += 1
    await handle.dispose()
    handle = await ctx.sessionProjections.register(createProjection(runtime))
  }

  const describe = () => ({
    showPills: settings.showPills,
    showPerTurn: settings.showPerTurn,
    fx,
    meta: runtime.meta,
    lastRefresh,
    table: summarizeTable(runtime.table, fx),
    statePath: path,
  })

  const updateSettings = async (patch) => {
    if (typeof patch.showPills === 'boolean') settings.showPills = patch.showPills
    if (typeof patch.showPerTurn === 'boolean') settings.showPerTurn = patch.showPerTurn
    await persist()
  }

  const refresh = async () => {
    if (refreshing) return { status: 'busy', message: '正在更新，请稍候' }
    refreshing = true
    try {
      const result = await refreshComputedTable({ fx, timeoutMs, attempts, previous: runtime.table })
      const at = new Date().toISOString()
      let message = result.message
      if (result.status === 'ok' || result.status === 'partial') {
        const jumped = bucketJump(runtime.table, result.table)
        runtime.table = result.table
        runtime.meta = { source: 'web', fetchedAt: result.table.fetchedAt, stale: false }
        await restart()
        if (jumped) message += '；价表变动较大，请核对'
      }
      lastRefresh = { at, status: result.status, message }
      await persist()
      return { status: result.status, message, at, detail: detailDigest(result.detail) }
    } finally {
      refreshing = false
    }
  }

  const reset = async () => {
    runtime.table = BUILTIN_TABLE
    runtime.meta = { source: 'builtin', fetchedAt: BUILTIN_TABLE.fetchedAt, stale: true }
    lastRefresh = { at: new Date().toISOString(), status: 'reset', message: '已恢复内置价表' }
    await restart()
    await persist()
  }

  registerRoutes(ctx, { describe, updateSettings, refresh, reset })
}
