import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatMicro, moneyOf, priceUnit, roundMicro, segmentNumerator, vendorOf,
} from '../lib/cost.js'
import { isDeepSeekPeak } from '../lib/period.js'
import { BUILTIN_TABLE } from '../lib/table.js'

test('formatMicro trims trailing zeros and keeps six decimals', () => {
  assert.equal(formatMicro(218680n), '0.21868')
  assert.equal(formatMicro(500000n), '0.5')
  assert.equal(formatMicro(1000000n), '1')
  assert.equal(formatMicro(1234567n), '1.234567')
  assert.equal(formatMicro(1n), '0.000001')
  assert.equal(formatMicro(0n), '0')
})

test('roundMicro rounds half up at the seventh decimal', () => {
  assert.equal(roundMicro(218679520n), 218680n)
  assert.equal(roundMicro(218679499n), 218679n)
  assert.equal(roundMicro(500n), 1n)
})

test('moneyOf flags a nonzero cost that rounds to zero', () => {
  assert.deepEqual(moneyOf(0n, 400n), { cost: '0', tiny: true })
  assert.deepEqual(moneyOf(0n, 0n), { cost: '0', tiny: false })
  assert.deepEqual(moneyOf(218680n, 218679520n), { cost: '0.21868', tiny: false })
})

test('vendorOf maps provider and model routes', () => {
  assert.equal(vendorOf('deepseek-account', 'deepseek-flash'), 'deepseek')
  assert.equal(vendorOf('deepseek', 'deepseek-v4-pro'), 'deepseek')
  assert.equal(vendorOf('xai', 'grok-4.7'), 'xai')
  assert.equal(vendorOf('openai', 'grok-4.3'), 'xai')
  assert.equal(vendorOf('local', 'qwen-image'), null)
})

test('DeepSeek peak window follows Beijing weekday hours', () => {
  // 2026-11-17 is a Tuesday; 02:30Z = 10:30 Beijing.
  assert.equal(isDeepSeekPeak(Date.UTC(2026, 10, 17, 2, 30)), true)
  // 12:30 Beijing sits between the two windows.
  assert.equal(isDeepSeekPeak(Date.UTC(2026, 10, 17, 4, 30)), false)
  // 14:00 Beijing opens the second window.
  assert.equal(isDeepSeekPeak(Date.UTC(2026, 10, 17, 6, 0)), true)
  // 17:59 Beijing is still peak.
  assert.equal(isDeepSeekPeak(Date.UTC(2026, 10, 17, 9, 59)), true)
  // 18:00 Beijing closes it.
  assert.equal(isDeepSeekPeak(Date.UTC(2026, 10, 17, 10, 0)), false)
  // Saturday 10:30 Beijing is off-peak.
  assert.equal(isDeepSeekPeak(Date.UTC(2026, 10, 21, 2, 30)), false)
})

test('DeepSeek unit prices are CNY with no FX conversion', () => {
  const offPeak = priceUnit(BUILTIN_TABLE, { v: 'deepseek', m: 'deepseek-flash', period: 'off' }, 6.7)
  const peak = priceUnit(BUILTIN_TABLE, { v: 'deepseek', m: 'deepseek-flash', period: 'peak' }, 6.7)
  // milli-CNY per 1M tokens: 1 元 -> 1000, 0.02 元 -> 20.
  assert.deepEqual(offPeak, { input: 1000n, cache: 20n, out: 4000n })
  assert.deepEqual(peak, { input: 2000n, cache: 40n, out: 8000n })
  // A different FX rate must not move a CNY price.
  const otherFx = priceUnit(BUILTIN_TABLE, { v: 'deepseek', m: 'deepseek-flash', period: 'off' }, 9.9)
  assert.deepEqual(otherFx, offPeak)
})

test('Grok unit prices follow the context tier and the FX rate', () => {
  const short = priceUnit(BUILTIN_TABLE, { v: 'xai', m: 'grok-4.3', tier: 'short' }, 6.7)
  const long = priceUnit(BUILTIN_TABLE, { v: 'xai', m: 'grok-4.3', tier: 'long' }, 6.7)
  // 1.25 USD -> 8.375 CNY -> 8375 milli; 0.2 USD -> 1.34 CNY -> 1340 milli.
  assert.deepEqual(short, { input: 8375n, cache: 1340n, out: 16750n })
  assert.deepEqual(long, { input: 16750n, cache: 2680n, out: 33500n })
})

test('current DeepSeek aliases and grok-build use their documented rates', () => {
  const flash = BUILTIN_TABLE.vendors.deepseek.models['deepseek-flash']
  assert.deepEqual(BUILTIN_TABLE.vendors.deepseek.models['deepseek-v4-flash'], flash)
  assert.deepEqual(BUILTIN_TABLE.vendors.deepseek.models['deepseek-v4-flash-vision-exp'], flash)
  const buildShort = priceUnit(BUILTIN_TABLE, { v: 'xai', m: 'grok-build-0.1', tier: 'short' }, 6.7)
  const buildLong = priceUnit(BUILTIN_TABLE, { v: 'xai', m: 'grok-build-0.1', tier: 'long' }, 6.7)
  assert.deepEqual(buildShort, { input: 6700n, cache: 1340n, out: 13400n })
  assert.deepEqual(buildLong, { input: 13400n, cache: 2680n, out: 26800n })
})

test('unknown model and unknown vendor are unpriced, not zero', () => {
  assert.equal(priceUnit(BUILTIN_TABLE, { v: 'xai', m: 'grok-9.9', tier: 'short' }, 6.7), null)
  assert.equal(priceUnit(BUILTIN_TABLE, { v: null, m: 'mystery' }, 6.7), null)
})

test('segmentNumerator bills cache writes at the input price', () => {
  const unit = { input: 1000n, cache: 20n, out: 4000n }
  const seg = { u: 100, r: 1000, w: 50, o: 10 }
  // 100*1000 + 50*1000 + 1000*20 + 10*4000 = 210000 milli -> 210 micro CNY.
  assert.equal(segmentNumerator(seg, unit), 210000n)
  assert.equal(roundMicro(segmentNumerator(seg, unit)), 210n)
  assert.equal(formatMicro(roundMicro(segmentNumerator(seg, unit))), '0.00021')
})
