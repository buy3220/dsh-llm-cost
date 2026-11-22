/**
 * The `llmCost` session projection: a pure fold of durable model settlements
 * into exact per-turn token buckets plus CNY cost.
 *
 * Every billable request with provider-reported usage is classified once, at
 * fold time. That includes normal assistant attempts and compaction summaries;
 * the latter carry their own provider/model attribution and usage. DeepSeek is
 * classified by Beijing peak/off-peak window, xAI by the prompt-length tier of
 * that single request. Cost is computed in `view()` from the active rate table.
 */

import { isDeepSeekPeak } from './period.js'
import {
  addBuckets, moneyOf, priceUnit, roundMicro, segmentNumerator, vendorOf, zeroBuckets,
} from './cost.js'

const SETTLEMENT_TYPES = new Set(['assistant/message', 'assistant/attempt'])

/** Compact durable usage of one aux request that did not belong to a Turn. */
const AUXILIARY_KIND = 'auxiliary'

/** Minimal schema object: the projection seam only calls `parse`. */
const stateSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.turns)) {
      return { turns: [], auxiliary: [], compactions: {}, last: null, route: null, routeExact: false }
    }
    return {
      ...value,
      auxiliary: Array.isArray(value.auxiliary) ? value.auxiliary : [],
      compactions: value.compactions && typeof value.compactions === 'object' && !Array.isArray(value.compactions)
        ? value.compactions
        : {},
      routeExact: value.routeExact === true,
    }
  },
}

const viewSchema = {
  parse(value) {
    return value
  },
}

/** Durable token buckets of one settlement, or undefined when unusable. */
function bucketsOf(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage.inputTokens
  const o = usage.outputTokens
  if (!Number.isSafeInteger(u) || !Number.isSafeInteger(o) || u < 0 || o < 0) return undefined
  const r = usage.cacheReadTokens
  const w = usage.cacheWriteTokens
  if (r !== undefined && (!Number.isSafeInteger(r) || r < 0)) return undefined
  if (w !== undefined && (!Number.isSafeInteger(w) || w < 0)) return undefined
  return { u, r: r ?? 0, w: w ?? 0, o }
}

/** Usage of one settlement: the explicit field first, else the stream's last usage chunk. */
function settlementUsage(data) {
  if (!data || typeof data !== 'object') return undefined
  if (data.usage !== undefined) return data.usage
  const stream = data.stream
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record && record.type === 'chunk' && record.chunk && record.chunk.type === 'usage') {
      return record.chunk.usage
    }
  }
  return undefined
}

/** Provider/model attributed to one settlement message. */
function routeOf(event) {
  const source = event?.data?.message?.source
  if (!source || typeof source !== 'object') return undefined
  return routeFromParts(source.provider, source.model)
}

/** Validated provider/model route, or undefined when either half is unusable. */
function routeFromParts(provider, model) {
  if (typeof provider !== 'string' || typeof model !== 'string') return undefined
  if (provider.length === 0 || model.length === 0) return undefined
  return { p: provider, m: model }
}

/** Exact route recorded by a request header/context event. */
function routeOfRequest(event) {
  if (event.type === 'request/header') {
    const config = event.data?.header?.config
    return routeFromParts(config?.provider, config?.model)
  }
  if (event.type === 'request/context') {
    return routeFromParts(event.data?.provider, event.data?.model)
  }
  return undefined
}

/** Index of one turn record, searching from the tail (the usual case is last). */
function indexOfTurn(turns, turn) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].turn === turn) return index
  }
  return -1
}

/**
 * Build the projection definition bound to one live runtime.
 * @param runtime - `{ table, fx, rev }`, read fresh on every view.
 * @returns the definition plus its memoized view.
 */
export function createProjection(runtime) {
  let memoState
  let memoRev = -1
  let memoValue = null

  /** Add one independently priced request to a display group. */
  function addGroupSegment(groups, seg, priced, numerator) {
    const kind = seg.kind ?? 'assistant'
    const key = `${kind}\u0000${seg.p}\u0000${seg.m}\u0000${seg.period ?? ''}\u0000${seg.tier ?? ''}`
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        kind,
        p: seg.p,
        m: seg.m,
        period: seg.period ?? null,
        tier: seg.tier ?? null,
        calls: 0,
        buckets: zeroBuckets(),
        numerator: 0n,
        priced: false,
      }
      groups.set(key, group)
    }
    group.calls += 1
    addBuckets(group.buckets, seg)
    if (!priced) return
    group.numerator += numerator
    group.priced = true
  }

  /** Render grouped pricing details, largest amount first. */
  function renderGroups(groups) {
    return [...groups.values()]
      .sort((left, right) => (left.numerator === right.numerator ? 0 : left.numerator < right.numerator ? 1 : -1))
      .map((group) => {
        const money = moneyOf(roundMicro(group.numerator), group.numerator)
        return {
          kind: group.kind,
          provider: group.p,
          model: group.m,
          period: group.period,
          tier: group.tier,
          calls: group.calls,
          cost: money.cost,
          tiny: money.tiny,
          priced: group.priced,
          tokens: {
            input: group.buckets.u,
            cacheRead: group.buckets.r,
            cacheWrite: group.buckets.w,
            output: group.buckets.o,
            total: group.buckets.u + group.buckets.r + group.buckets.w + group.buckets.o,
          },
        }
      })
  }

  function buildView(state) {
    const total = zeroBuckets()
    const turns = {}
    const totalGroups = new Map()
    const unpriced = new Set()
    let lastTurn = null
    let totalNumerator = 0n

    for (const record of state.turns) {
      const buckets = zeroBuckets()
      const groups = new Map()
      let numerator = 0n
      let inferred = 0
      let complete = true
      for (const seg of Array.isArray(record.segs) ? record.segs : []) {
        addBuckets(buckets, seg)
        if (seg.inferred) inferred += 1
        const unit = priceUnit(runtime.table, seg, runtime.fx)
        if (unit === null) {
          unpriced.add(`${seg.p || '?'}/${seg.m || '?'}`)
          complete = false
          addGroupSegment(groups, seg, false, 0n)
          addGroupSegment(totalGroups, seg, false, 0n)
          continue
        }
        const part = segmentNumerator(seg, unit)
        addGroupSegment(groups, seg, true, part)
        addGroupSegment(totalGroups, seg, true, part)
        numerator += part
      }

      addBuckets(total, buckets)
      totalNumerator += numerator
      lastTurn = record.turn

      const turnMoney = moneyOf(roundMicro(numerator), numerator)
      turns[String(record.turn)] = {
        turn: record.turn,
        closed: record.closed === true,
        cost: turnMoney.cost,
        tiny: turnMoney.tiny,
        complete,
        priced: groups.size > 0 && [...groups.values()].some((group) => group.priced),
        inferred,
        tokens: {
          input: buckets.u,
          cacheRead: buckets.r,
          cacheWrite: buckets.w,
          output: buckets.o,
          total: buckets.u + buckets.r + buckets.w + buckets.o,
        },
        groups: renderGroups(groups),
      }
    }

    // A manual compaction has no Turn number. It is still a real billable
    // request, so include it in session totals and the cumulative breakdown.
    for (const seg of Array.isArray(state.auxiliary) ? state.auxiliary : []) {
      addBuckets(total, seg)
      const unit = priceUnit(runtime.table, seg, runtime.fx)
      if (unit === null) {
        unpriced.add(`${seg.p || '?'}/${seg.m || '?'}`)
        addGroupSegment(totalGroups, seg, false, 0n)
        continue
      }
      const part = segmentNumerator(seg, unit)
      addGroupSegment(totalGroups, seg, true, part)
      totalNumerator += part
    }

    const totalMoney = moneyOf(roundMicro(totalNumerator), totalNumerator)
    return {
      ready: total.u + total.r + total.w + total.o > 0,
      rev: runtime.rev,
      fx: runtime.fx,
      lastTurn,
      total: {
        cost: totalMoney.cost,
        tiny: totalMoney.tiny,
        complete: unpriced.size === 0,
        priced: [...totalGroups.values()].some((group) => group.priced),
        tokens: {
          input: total.u,
          cacheRead: total.r,
          cacheWrite: total.w,
          output: total.o,
          total: total.u + total.r + total.w + total.o,
        },
        groups: renderGroups(totalGroups),
      },
      turns,
      unpriced: [...unpriced],
      tableSource: runtime.meta?.source ?? 'builtin',
      tableFetchedAt: runtime.meta?.fetchedAt ?? null,
      tableStale: runtime.meta?.stale === true,
    }
  }

  /** Classify one billable request using the dimensions its vendor prices. */
  function segmentFor(route, buckets, time, kind, inferred) {
    const provider = route?.p ?? ''
    const model = route?.m ?? ''
    const vendor = vendorOf(provider, model)
    const promptTokens = buckets.u + buckets.r + buckets.w
    let period = null
    let tier = null
    if (vendor === 'deepseek') {
      period = isDeepSeekPeak(time) ? 'peak' : 'off'
    } else if (vendor === 'xai') {
      const configuredThreshold = Number(runtime.table?.vendors?.xai?.tierThreshold)
      const threshold = Number.isSafeInteger(configuredThreshold) && configuredThreshold > 0
        ? configuredThreshold
        : 200000
      tier = promptTokens >= threshold ? 'long' : 'short'
    }
    return {
      kind,
      p: provider,
      m: model,
      v: vendor,
      period,
      tier,
      u: buckets.u,
      r: buckets.r,
      w: buckets.w,
      o: buckets.o,
      inferred,
    }
  }

  const definition = {
    key: 'llmCost',
    stateVersion: 2,
    stateSchema,
    init: () => ({
      turns: [],
      auxiliary: [],
      compactions: {},
      last: null,
      route: null,
      routeExact: false,
    }),
    apply(state, event) {
      const requestRoute = routeOfRequest(event)
      if (requestRoute !== undefined) {
        return { ...state, route: requestRoute, routeExact: true }
      }

      if (event.type === 'turn/start') {
        if (indexOfTurn(state.turns, event.data.turn) >= 0) return state
        const turns = [...state.turns, { turn: event.data.turn, closed: false, segs: [] }]
        return { ...state, turns, last: null }
      }
      if (event.type === 'turn/end') {
        const index = indexOfTurn(state.turns, event.data.turn)
        if (index < 0) return state
        if (state.turns[index].closed === true) return state
        const turns = state.turns.slice()
        turns[index] = { ...turns[index], closed: true }
        return { ...state, turns, last: null }
      }
      if (event.type === 'compaction/start') {
        const id = String(event.data.compactionId)
        const turn = Number.isSafeInteger(event.data.turn) && event.data.turn >= 0
          ? event.data.turn
          : null
        return { ...state, compactions: { ...state.compactions, [id]: turn } }
      }
      if (event.type === 'compaction/end') {
        const id = String(event.data.compactionId)
        if (!Object.hasOwn(state.compactions, id)) return state
        const compactions = Object.fromEntries(
          Object.entries(state.compactions).filter(([key]) => key !== id),
        )
        return { ...state, compactions }
      }
      if (event.type === 'compaction/summary') {
        const buckets = bucketsOf(event.data?.usage)
        if (buckets === undefined) return state
        const route = routeFromParts(event.data?.provider, event.data?.model)
        const seg = segmentFor(route, buckets, event.time, 'compaction', false)
        const id = String(event.data.compactionId)
        const mappedTurn = Object.hasOwn(state.compactions, id) ? state.compactions[id] : null
        if (!Number.isSafeInteger(mappedTurn) || mappedTurn < 0) {
          return { ...state, auxiliary: [...state.auxiliary, seg] }
        }
        const turns = state.turns.slice()
        let index = indexOfTurn(turns, mappedTurn)
        if (index < 0) {
          turns.push({ turn: mappedTurn, closed: false, segs: [] })
          index = turns.length - 1
        }
        const record = turns[index]
        turns[index] = {
          ...record,
          segs: [...(Array.isArray(record.segs) ? record.segs : []), seg],
        }
        return { ...state, turns }
      }
      if (event.type === 'llm/retry-started') {
        if (state.last === null) return state
        if (state.last.turn !== event.data.turn || state.last.step !== event.data.step) return state
        return { ...state, last: null }
      }
      if (!SETTLEMENT_TYPES.has(event.type)) return state

      const data = event.data
      const buckets = bucketsOf(settlementUsage(data))
      if (buckets === undefined) return state

      const attributed = routeOf(event)
      const route = attributed ?? state.route
      const inferred = attributed === undefined && state.routeExact !== true
      const seg = segmentFor(route, buckets, event.time, 'assistant', inferred)

      const turnNumber = data.turn
      let index = indexOfTurn(state.turns, turnNumber)
      const turns = state.turns.slice()
      if (index < 0) {
        turns.push({ turn: turnNumber, closed: false, segs: [] })
        index = turns.length - 1
      }
      const record = { ...turns[index] }
      record.segs = Array.isArray(record.segs) ? record.segs : []
      const last = state.last
      const replace = last !== null
        && last.turn === data.turn
        && last.step === data.step
        && record.segs[last.index] !== undefined
      if (replace) {
        const segs = record.segs.slice()
        segs[last.index] = seg
        record.segs = segs
        turns[index] = record
        return {
          ...state,
          turns,
          last,
          route: attributed ?? state.route,
          routeExact: state.routeExact,
        }
      }
      record.segs = [...record.segs, seg]
      turns[index] = record
      return {
        ...state,
        turns,
        last: { turn: data.turn, step: data.step, index: record.segs.length - 1 },
        route: attributed ?? state.route,
        routeExact: false,
      }
    },
    wire: {
      viewSchema,
      summary: false,
      view(state) {
        if (state === memoState && runtime.rev === memoRev && memoValue !== null) return memoValue
        memoState = state
        memoRev = runtime.rev
        memoValue = buildView(state)
        return memoValue
      },
    },
  }

  return definition
}
