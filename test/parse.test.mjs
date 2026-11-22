import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDeepseek, parseXai, withDeepseekAliases } from '../lib/fetch-rules.js'

/** A miniature of the DeepSeek zh-CN page: two model columns, two periods each. */
const DEEPSEEK_HTML = `<html><body>
<table>
  <tr><th>模型</th><th>deepseek-flash(1)</th><th>deepseek-v4-pro</th></tr>
  <tr>
    <td>价格(2)</td>
    <td>百万tokens输入（缓存命中）</td>
    <td>空闲时段</td><td>0.02元</td><td>0.15元</td>
    <td>高峰时段</td><td>0.04元</td><td>0.30元</td>
  </tr>
  <tr>
    <td></td>
    <td>百万tokens输入（缓存未命中）</td>
    <td>空闲时段</td><td>1元</td><td>4.5元</td>
    <td>高峰时段</td><td>2元</td><td>9.0元</td>
  </tr>
  <tr>
    <td></td>
    <td>百万tokens输出</td>
    <td>空闲时段</td><td>4元</td><td>13.5元</td>
    <td>高峰时段</td><td>8元</td><td>27.0元</td>
  </tr>
  <tr><td>并发限制(3)</td><td>2500</td><td>500</td></tr>
</table>
</body></html>`

/** A miniature of the xAI pricing page rendered as markdown. */
const XAI_MARKDOWN = `# Pricing

| Model | Context | Input / 1M tokens | Cached input / 1M tokens | Output / 1M tokens |
| --- | --- | --- | --- | --- |
| grok-4.7 (< 200k prompt tokens) | 500k | $2.00 | $0.50 | $6.00 |
| grok-4.7 (≥ 200k prompt tokens) | 500k | $4.00 | $1.00 | $12.00 |
| grok-4.3 (< 200k prompt tokens) | 1M | $1.25 | $0.20 | $2.50 |
| grok-4.3 (≥ 200k prompt tokens) | 1M | $2.50 | $0.40 | $5.00 |
`

test('the DeepSeek page parses into CNY prices with two periods', () => {
  const parsed = parseDeepseek(DEEPSEEK_HTML)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.currency, 'CNY')
  assert.deepEqual(parsed.models['deepseek-flash'], {
    hit: { off: 0.02, peak: 0.04 },
    miss: { off: 1, peak: 2 },
    out: { off: 4, peak: 8 },
  })
  assert.deepEqual(parsed.models['deepseek-v4-pro'], {
    hit: { off: 0.15, peak: 0.3 },
    miss: { off: 4.5, peak: 9 },
    out: { off: 13.5, peak: 27 },
  })
})

test('fetched DeepSeek prices retain the documented callable Flash aliases', () => {
  const parsed = parseDeepseek(DEEPSEEK_HTML)
  const models = withDeepseekAliases(parsed.models)
  assert.deepEqual(models['deepseek-v4-flash'], models['deepseek-flash'])
  assert.deepEqual(models['deepseek-v4-flash-vision-exp'], models['deepseek-flash'])
})

test('a per-request price table is reported as a framework mismatch', () => {
  const html = `<table>
    <tr><th>deepseek-flash</th><th>deepseek-v4-pro</th></tr>
    <tr><td>价格</td><td>按次计费</td><td>每次</td><td>1元</td><td>2元</td></tr>
  </table>`
  const parsed = parseDeepseek(html)
  assert.equal(parsed.status, 'mismatch')
  assert.match(parsed.message, /缓存命中|缓存未命中|输出/)
})

test('the xAI markdown table parses into short and long tiers', () => {
  const parsed = parseXai(XAI_MARKDOWN)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.currency, 'USD')
  assert.deepEqual(parsed.models['grok-4.7'].tiers, [
    { input: 2, cacheRead: 0.5, output: 6 },
    { input: 4, cacheRead: 1, output: 12 },
  ])
  assert.deepEqual(parsed.models['grok-4.3'].tiers[0], { input: 1.25, cacheRead: 0.2, output: 2.5 })
})

test('the same xAI table served as HTML still parses', () => {
  const html = `<table>
    <tr><th>Model</th><th>Context</th><th>Input / 1M tokens</th><th>Cached input / 1M tokens</th><th>Output / 1M tokens</th></tr>
    <tr><td>grok-4.7 (&lt; 200k prompt tokens)</td><td>500k</td><td>$2.00</td><td>$0.50</td><td>$6.00</td></tr>
    <tr><td>grok-4.7 (≥ 200k prompt tokens)</td><td>500k</td><td>$4.00</td><td>$1.00</td><td>$12.00</td></tr>
  </table>`
  const parsed = parseXai(html)
  assert.equal(parsed.status, 'ok')
  assert.deepEqual(parsed.models['grok-4.7'].tiers[1], { input: 4, cacheRead: 1, output: 12 })
})

test('a flat per-token table without tiers is a mismatch', () => {
  const markdown = `| Model | Input | Output |
| --- | --- | --- |
| grok-4.7 | $2.00 | $6.00 |`
  const parsed = parseXai(markdown)
  assert.equal(parsed.status, 'mismatch')
})
