import test from 'node:test'
import assert from 'node:assert/strict'

import { createProjection } from '../lib/projection.js'
import { BUILTIN_TABLE } from '../lib/table.js'

/** Projection runtime shared by the cases below. */
function runtime(table = BUILTIN_TABLE, fx = 6.7) {
  return { table, fx, rev: 0, meta: { source: 'builtin' } }
}

/** Fold a whole event list into one view. */
function fold(events, rt = runtime()) {
  const definition = createProjection(rt)
  let state = definition.init({}, 0)
  for (const event of events) state = definition.apply(state, event)
  return definition.wire.view(state)
}

const at = Date.UTC(2026, 10, 17, 2, 30) // Tuesday 10:30 Beijing -> peak
const offPeakAt = Date.UTC(2026, 10, 17, 11, 30) // Tuesday 19:30 Beijing -> off-peak

const deepseekUsage = { inputTokens: 88120, outputTokens: 18101, cacheReadTokens: 2907776, cacheWriteTokens: 0 }

test('deepseek turn prices in CNY at the off-peak rate', () => {
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: 1,
      time: offPeakAt,
      data: { turn: 1, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: deepseekUsage },
    },
    { type: 'turn/end', seq: 2, time: offPeakAt, data: { turn: 1 } },
  ])
  assert.equal(view.total.cost, '0.21868')
  assert.equal(view.turns['1'].cost, '0.21868')
  assert.equal(view.turns['1'].closed, true)
  assert.equal(view.turns['1'].groups[0].period, 'off')
  assert.deepEqual(view.unpriced, [])
})

test('the same tokens inside the peak window cost double', () => {
  const view = fold([
    { type: 'turn/start', seq: 0, time: at, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: 1,
      time: at,
      data: { turn: 1, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: deepseekUsage },
    },
  ])
  assert.equal(view.total.cost, '0.437359')
  assert.equal(view.turns['1'].groups[0].period, 'peak')
  assert.equal(view.turns['1'].closed, false)
})

test('grok splits one turn by context tier and sums both groups', () => {
  const short = { inputTokens: 50000, outputTokens: 2000, cacheReadTokens: 100000, cacheWriteTokens: 0 }
  const long = { inputTokens: 200000, outputTokens: 3000, cacheReadTokens: 50000, cacheWriteTokens: 0 }
  const settle = (step, usage) => ({
    type: 'assistant/message',
    seq: step + 1,
    time: offPeakAt,
    data: { turn: 7, step, message: { source: { provider: 'xai', model: 'grok-4.7' } }, usage },
  })
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 7 } },
    settle(0, short),
    settle(1, long),
    { type: 'turn/end', seq: 9, time: offPeakAt, data: { turn: 7 } },
  ])
  assert.equal(view.total.cost, '7.0216')
  const groups = view.turns['7'].groups
  assert.deepEqual(groups.map(group => group.tier), ['long', 'short'])
  assert.deepEqual(groups.map(group => group.cost), ['5.9362', '1.0854'])
})

test('a second settlement for one step replaces the first', () => {
  const first = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const second = { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const settle = (seq, usage) => ({
    type: 'assistant/message',
    seq,
    time: offPeakAt,
    data: { turn: 1, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage },
  })
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    settle(1, first),
    settle(2, second),
  ])
  assert.equal(view.total.tokens.input, 2000)
  assert.equal(view.turns['1'].groups[0].calls, 1)
})

test('a retried attempt adds a new billed request instead of replacing', () => {
  const first = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const second = { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const settle = (seq, usage) => ({
    type: 'assistant/message',
    seq,
    time: offPeakAt,
    data: { turn: 1, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage },
  })
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    settle(1, first),
    { type: 'llm/retry-started', seq: 2, time: offPeakAt, data: { turn: 1, step: 0 } },
    settle(3, second),
  ])
  assert.equal(view.total.tokens.input, 3000)
  assert.equal(view.turns['1'].groups[0].calls, 2)
})

test('an attempt without a message source inherits the last known route', () => {
  const usage = { inputTokens: 500, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: 1,
      time: offPeakAt,
      data: { turn: 1, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage },
    },
    { type: 'assistant/attempt', seq: 2, time: offPeakAt, data: { turn: 1, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] } },
  ])
  assert.equal(view.unpriced.length, 0)
  assert.equal(view.turns['1'].inferred, 1)
  assert.equal(view.turns['1'].groups[0].calls, 2)
})

test('an unpriced model is listed and left out of the total', () => {
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: 1,
      time: offPeakAt,
      data: { turn: 1, step: 0, message: { source: { provider: 'local', model: 'mystery' } }, usage: { inputTokens: 10, outputTokens: 5 } },
    },
  ])
  assert.deepEqual(view.unpriced, ['local/mystery'])
  assert.equal(view.total.cost, '0')
  assert.equal(view.total.complete, false)
  assert.equal(view.total.priced, false)
  assert.equal(view.turns['1'].groups[0].priced, false)
})

test('a compaction summary with usage is billed in its turn', () => {
  const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    { type: 'compaction/start', seq: 1, time: offPeakAt, data: { compactionId: 'compact-1', turn: 1 } },
    {
      type: 'compaction/summary',
      seq: 2,
      time: offPeakAt,
      data: { compactionId: 'compact-1', provider: 'deepseek-account', model: 'deepseek-flash', usage },
    },
    { type: 'compaction/end', seq: 3, time: offPeakAt, data: { compactionId: 'compact-1' } },
    { type: 'turn/end', seq: 4, time: offPeakAt, data: { turn: 1 } },
  ])
  assert.equal(view.total.cost, '0.0014')
  assert.equal(view.turns['1'].cost, '0.0014')
  assert.equal(view.turns['1'].groups[0].kind, 'compaction')
  assert.equal(view.turns['1'].groups[0].calls, 1)
  assert.equal(view.total.tokens.total, 1100)
  assert.equal(view.total.complete, true)
})

test('a manual compaction without a turn remains in session totals', () => {
  const usage = { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const view = fold([
    { type: 'compaction/start', seq: 0, time: offPeakAt, data: { compactionId: 'manual-1', turn: null } },
    {
      type: 'compaction/summary',
      seq: 1,
      time: offPeakAt,
      data: { compactionId: 'manual-1', provider: 'deepseek-account', model: 'deepseek-flash', usage },
    },
  ])
  assert.equal(view.ready, true)
  assert.equal(view.lastTurn, null)
  assert.equal(view.total.cost, '0.0028')
  assert.equal(view.total.groups[0].kind, 'compaction')
  assert.equal(view.total.tokens.total, 2200)
})

test('a request header supplies the exact route for an attempt without a message source', () => {
  const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const view = fold([
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    {
      type: 'request/header',
      seq: 1,
      time: offPeakAt,
      data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash' } } },
    },
    {
      type: 'assistant/attempt',
      seq: 2,
      time: offPeakAt,
      data: { turn: 1, step: 0, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] },
    },
  ])
  assert.equal(view.turns['1'].inferred, 0)
  assert.equal(view.turns['1'].groups[0].provider, 'deepseek-account')
  assert.equal(view.turns['1'].cost, '0.0014')
})

test('a request context updates the exact route before a later attempt', () => {
  const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const view = fold([
    { type: 'request/header', seq: 0, time: offPeakAt, data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash' } } } },
    { type: 'assistant/attempt', seq: 1, time: offPeakAt, data: { turn: 1, step: 0, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] } },
    { type: 'request/context', seq: 2, time: offPeakAt, data: { provider: 'deepseek-account', model: 'deepseek-v4-pro' } },
    { type: 'assistant/attempt', seq: 3, time: offPeakAt, data: { turn: 1, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] } },
  ])
  assert.equal(view.turns['1'].inferred, 0)
  assert.deepEqual(view.turns['1'].groups.map((group) => group.model).sort(), ['deepseek-flash', 'deepseek-v4-pro'])
})

test('session totals are not silently truncated at 4000 turns', () => {
  const usage = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const events = [
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: 1,
      time: offPeakAt,
      data: {
        turn: 1,
        step: 0,
        message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } },
        usage,
      },
    },
  ]
  for (let turn = 2; turn <= 4002; turn += 1) {
    events.push({ type: 'turn/start', seq: turn * 2, time: offPeakAt, data: { turn } })
  }
  const view = fold(events)
  assert.equal(view.turns['1'].cost, '0.001')
  assert.equal(view.total.cost, '0.001')
})

test('a repriced table reprices history on the next view', () => {
  const rt = runtime()
  const definition = createProjection(rt)
  const events = [
    { type: 'turn/start', seq: 0, time: offPeakAt, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: 1,
      time: offPeakAt,
      data: { turn: 1, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: deepseekUsage },
    },
  ]
  let state = definition.init({}, 0)
  for (const event of events) state = definition.apply(state, event)
  assert.equal(definition.wire.view(state).total.cost, '0.21868')

  rt.table = {
    ...BUILTIN_TABLE,
    vendors: {
      ...BUILTIN_TABLE.vendors,
      deepseek: {
        ...BUILTIN_TABLE.vendors.deepseek,
        models: {
          'deepseek-flash': {
            hit: { off: 0.04, peak: 0.08 },
            miss: { off: 2, peak: 4 },
            out: { off: 8, peak: 16 },
          },
        },
      },
    },
  }
  rt.rev += 1
  assert.equal(definition.wire.view(state).total.cost, '0.437359')
})
