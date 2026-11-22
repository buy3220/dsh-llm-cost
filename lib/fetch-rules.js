/**
 * Fetching and parsing the two official price pages.
 *
 * The parser is deliberately structural: it asserts the billing framework it
 * knows (per-million tokens, three buckets, two DeepSeek periods / two xAI
 * context tiers) before anything is applied. A page that no longer matches
 * yields `mismatch` — the live table stays untouched and the UI says the
 * plugin needs a code update.
 */

import { TABLE_VERSION } from './table.js'

const DEEPSEEK_CNY = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const DEEPSEEK_USD = 'https://api-docs.deepseek.com/quick_start/pricing'
/** The same URL answers markdown when asked for it, and HTML otherwise. */
const XAI_PRICING = 'https://docs.x.ai/developers/pricing'

const BACKOFF_MS = [400, 1200, 3000]
const EXCERPT_LIMIT = 600
const DEEPSEEK_FLASH_ALIASES = ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']

const EXPECTED = {
  deepseek: {
    vendor: 'deepseek',
    framework: 'per-1M-tokens',
    buckets: ['cacheHit', 'cacheMiss', 'output'],
    periods: ['off', 'peak'],
    currency: 'CNY',
  },
  xai: {
    vendor: 'xai',
    framework: 'per-1M-tokens',
    buckets: ['input', 'cachedInput', 'output'],
    tiers: ['short(<200k)', 'long(>=200k)'],
    currency: 'USD',
  },
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * One GET with a hard timeout, retrying only transport errors, 5xx and 429.
 * @param url - absolute URL.
 * @param options - `{ timeoutMs, attempts, accept }`.
 * @returns the response body as text.
 */
export async function fetchText(url, { timeoutMs = 8000, attempts = 3, accept } = {}) {
  let lastError
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      const response = await fetch(url, {
        signal,
        redirect: 'follow',
        headers: {
          accept: accept ?? 'text/html,text/markdown,text/plain;q=0.9,*/*;q=0.8',
          'user-agent': 'dsh-llm-cost/1.0 (+dsh plugin)',
        },
      })
      if (response.ok) return await response.text()
      const retryable = response.status >= 500 || response.status === 429
      const error = new Error(`HTTP ${response.status} ${url}`)
      if (!retryable) throw error
      lastError = error
    } catch (error) {
      if (error && error.name === 'TimeoutError') {
        lastError = new Error(`timeout after ${timeoutMs}ms ${url}`)
      } else {
        lastError = error
      }
      if (error && /^HTTP 4/.test(String(error.message)) && !/HTTP 429/.test(String(error.message))) throw error
    }
    if (attempt < attempts - 1) await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)])
  }
  throw lastError ?? new Error(`failed ${url}`)
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
}

/**
 * Split an HTML document into trimmed cell strings.
 * @param html - raw document.
 * @returns cell text in document order.
 */
function cellsFromHtml(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(td|th)>/gi, '\u0001')
    .replace(/<\/(tr)>/gi, '\u0002')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(stripped)
    .split(/[\u0001\u0002\n]/)
    .map((cell) => cell.replace(/\s+/g, ' ').trim())
    .filter((cell) => cell.length > 0)
}

/** Parse one money cell into `{ value, currency }`. */
function parseMoney(cell) {
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(cell)
  if (match === null) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  const currency = cell.includes('元') || cell.includes('￥') ? 'CNY' : cell.includes('$') ? 'USD' : undefined
  return { value, currency }
}

/** Collect the two numbers after each period label inside one label window. */
function collectPeriods(cells) {
  const out = { off: [], peak: [] }
  let current
  for (const cell of cells) {
    if (cell.includes('空闲')) { current = 'off'; continue }
    if (cell.includes('高峰')) { current = 'peak'; continue }
    const money = parseMoney(cell)
    if (money !== undefined && current !== undefined) out[current].push(money)
    if (out.off.length >= 2 && out.peak.length >= 2) break
  }
  return out
}

/**
 * Parse the DeepSeek price table.
 * @param html - page HTML.
 * @returns a parse result with models or a mismatch description.
 */
export function parseDeepseek(html) {
  const cells = cellsFromHtml(html)
  const modelIds = []
  for (const cell of cells) {
    const match = /^(deepseek-[a-z0-9.-]+)/i.exec(cell)
    if (match === null) continue
    const id = match[1].toLowerCase()
    if (!modelIds.includes(id)) modelIds.push(id)
    if (modelIds.length >= 4) break
  }
  if (modelIds.length < 2) {
    return { status: 'mismatch', message: '未在页面找到 DeepSeek 模型列', found: { models: modelIds }, expected: EXPECTED.deepseek }
  }
  const header = modelIds.slice(0, 2)

  const grep = (matcher) => {
    for (let index = 0; index < cells.length; index += 1) {
      if (!matcher(cells[index])) continue
      const collected = collectPeriods(cells.slice(index + 1, index + 10))
      if (collected.off.length >= 2 && collected.peak.length >= 2) return collected
    }
    return undefined
  }

  const hit = grep((cell) => cell.includes('缓存命中') && !cell.includes('未命中'))
  const miss = grep((cell) => cell.includes('缓存未命中'))
  const out = grep((cell) => /百万\s*tokens\s*输出/.test(cell.replace(/\s+/g, '')))
  if (hit === undefined || miss === undefined || out === undefined) {
    const missing = [hit === undefined ? '缓存命中' : null, miss === undefined ? '缓存未命中' : null, out === undefined ? '输出' : null].filter(Boolean)
    return {
      status: 'mismatch',
      message: `页面缺少${missing.join('、')}计价行`,
      found: { models: header, excerpt: cells.slice(0, 40).join(' ').slice(0, EXCERPT_LIMIT) },
      expected: EXPECTED.deepseek,
    }
  }

  const currency = hit.off[0].currency ?? hit.peak[0].currency ?? 'CNY'
  if (currency !== 'CNY') {
    return {
      status: 'mismatch',
      message: '中文页价格不再是人民币计价',
      found: { currency },
      expected: EXPECTED.deepseek,
    }
  }

  const models = {}
  header.forEach((id, column) => {
    models[id] = {
      hit: { off: hit.off[column].value, peak: hit.peak[column].value },
      miss: { off: miss.off[column].value, peak: miss.peak[column].value },
      out: { off: out.off[column].value, peak: out.peak[column].value },
    }
  })
  return { status: 'ok', currency, models }
}

/**
 * Attach the documented callable aliases of deepseek-flash to a fetched table.
 * The price page lists aliases only in a footnote, while billing follows Flash.
 */
export function withDeepseekAliases(models) {
  const flash = models?.['deepseek-flash']
  if (flash === undefined) return models
  const out = { ...models }
  for (const alias of DEEPSEEK_FLASH_ALIASES) out[alias] = flash
  return out
}

/**
 * Parse the xAI pricing markdown table.
 * @param markdown - the `.md` page body.
 * @returns a parse result with two-tier models or a mismatch description.
 */
export function parseXai(markdown) {
  const rows = []
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const inner = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1)
    const cells = inner.split('|').map((cell) => cell.trim())
    if (cells.length < 5) continue
    if (!/^grok-[a-z0-9.-]+/i.test(cells[0])) continue
    rows.push(cells)
  }
  // The same URL answers HTML when markdown is not negotiated: rebuild rows
  // from the table cells so a content-type change alone is not a mismatch.
  if (rows.length === 0 && /<t[dh][\s>]/i.test(markdown)) {
    const cells = cellsFromHtml(markdown)
    for (let index = 0; index < cells.length; index += 1) {
      if (!/^grok-[a-z0-9.-]+/i.test(cells[index])) continue
      const window = cells.slice(index, index + 5)
      if (window.length < 5) break
      rows.push(window)
      index += 4
    }
  }
  if (rows.length === 0) {
    return {
      status: 'mismatch',
      message: '未在 xAI 价目页找到 grok 模型行',
      found: { rows: 0 },
      expected: EXPECTED.xai,
    }
  }

  const models = {}
  for (const cells of rows) {
    const name = cells[0].split('(')[0].trim().toLowerCase()
    const label = cells[0].toLowerCase()
    const tierIndex = /≥|>=|> 200k/.test(label) ? 1 : 0
    const input = parseMoney(cells[2])
    const cached = parseMoney(cells[3])
    const output = parseMoney(cells[4])
    if (input === undefined || cached === undefined || output === undefined) continue
    if ((input.currency ?? 'USD') !== 'USD') continue
    const entry = models[name] ?? { tiers: [undefined, undefined] }
    entry.tiers[tierIndex] = { input: input.value, cacheRead: cached.value, output: output.value }
    models[name] = entry
  }

  const complete = {}
  for (const [name, entry] of Object.entries(models)) {
    if (entry.tiers[0] !== undefined && entry.tiers[1] !== undefined) complete[name] = entry
  }
  if (Object.keys(complete).length === 0) {
    return {
      status: 'mismatch',
      message: 'xAI 价格不再是「短档/长档」两段式结构',
      found: { models: Object.keys(models), tiers: Object.fromEntries(Object.entries(models).map(([k, v]) => [k, v.tiers.map(Boolean)])) },
      expected: EXPECTED.xai,
    }
  }
  return { status: 'ok', currency: 'USD', models: complete }
}

/**
 * Refresh both vendors, then merge into a usable table.
 * @param options - `{ fx, timeoutMs, attempts, previous }`.
 * @returns `{ status, message, table?, detail }` where status is ok | partial | mismatch | error.
 */
export async function refreshComputedTable({ fx, timeoutMs = 8000, attempts = 3, previous } = {}) {
  const startedAt = Date.now()
  const header = { 'cache-control': 'no-store' }

  const deepseekTask = (async () => {
    const tried = [DEEPSEEK_CNY, DEEPSEEK_USD]
    let lastError
    for (const url of tried) {
      try {
        const html = await fetchText(url, { timeoutMs, attempts })
        const parsed = parseDeepseek(html)
        return { ...parsed, url, ...header }
      } catch (error) {
        lastError = error
      }
    }
    return { status: 'error', message: `抓取失败：${lastError?.message ?? '未知错误'}`, url: tried[0] }
  })()

  const xaiTask = (async () => {
    const url = XAI_PRICING
    let lastError
    for (const accept of ['text/markdown, text/html;q=0.9, */*;q=0.8', 'text/html']) {
      try {
        const body = await fetchText(url, { timeoutMs, attempts, accept })
        const parsed = parseXai(body)
        if (parsed.status === 'ok') return { ...parsed, url, ...header }
        lastError = new Error(parsed.message)
      } catch (error) {
        lastError = error
      }
    }
    return {
      status: lastError && /未在|结构/.test(String(lastError.message)) ? 'mismatch' : 'error',
      message: lastError?.message ?? '未知错误',
      url,
    }
  })()

  const [deepseek, xai] = await Promise.all([deepseekTask, xaiTask])
  const detail = { deepseek, xai, tookMs: Date.now() - startedAt }
  const mismatched = [deepseek, xai].filter((entry) => entry.status === 'mismatch')
  if (mismatched.length > 0) {
    return {
      status: 'mismatch',
      message: `计费规则不匹配：${mismatched.map((entry) => entry.message).join('；')}`,
      detail,
    }
  }

  const vendors = { ...(previous?.vendors ?? {}) }
  if (deepseek.status === 'ok') {
    vendors.deepseek = {
      currency: 'CNY',
      unit: 1000000,
      dimension: 'period',
      peakWindows: [[540, 720], [840, 1080]],
      models: withDeepseekAliases(deepseek.models),
    }
  }
  if (xai.status === 'ok') {
    vendors.xai = {
      currency: 'USD',
      unit: 1000000,
      dimension: 'tier',
      tierThreshold: 200000,
      models: xai.models,
    }
  }

  const applied = [deepseek.status === 'ok' ? 'DeepSeek' : null, xai.status === 'ok' ? 'xAI' : null].filter(Boolean)
  if (applied.length === 0) {
    return { status: 'error', message: '两个来源都未取到可用的计费结构，已保留原价表', detail }
  }
  const table = {
    version: TABLE_VERSION,
    source: 'web',
    fetchedAt: new Date().toISOString(),
    vendors,
  }
  const status = applied.length === 2 ? 'ok' : 'partial'
  const failed = [deepseek, xai].filter((entry) => entry.status !== 'ok').map((entry) => entry.message)
  return {
    status,
    message: status === 'ok'
      ? `已更新 ${Object.keys(deepseek.models).length + Object.keys(xai.models).length} 个模型`
      : `部分更新：${applied.join('、')} 已更新；${failed.join('；')}`,
    table,
    detail,
  }
}

export { EXPECTED }
