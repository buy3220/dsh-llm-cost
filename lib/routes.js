/**
 * HTTP endpoints for the plugin page: read state, refresh the rate table from
 * the two official price pages, toggle the pills, restore the built-in table.
 *
 * These routes exist because a hand-authored bundle has no generated Typert
 * Remote surface; the browser half talks to the Host over same-origin fetch.
 */

const MAX_BODY_BYTES = 262144

/** Read and parse a JSON request body; empty bodies yield `{}`. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Answer one JSON response. */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Loopback-only: the plugin page is same-origin, everything else is refused. */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

/** Human-facing price lines for one vendor model, in the vendor currency. */
function priceLines(vendor, model, prices, fx) {
  const yuan = (usd) => (Number(usd) * fx).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  if (vendor === 'deepseek') {
    return [
      `缓存命中 ${prices.hit.off} / ${prices.hit.peak} 元`,
      `缓存未命中 ${prices.miss.off} / ${prices.miss.peak} 元`,
      `输出 ${prices.out.off} / ${prices.out.peak} 元`,
    ]
  }
  const [short, long] = prices.tiers ?? []
  if (!short || !long) return []
  return [
    `输入 $${short.input} / $${long.input}（￥${yuan(short.input)} / ￥${yuan(long.input)}）`,
    `缓存输入 $${short.cacheRead} / $${long.cacheRead}`,
    `输出 $${short.output} / $${long.output}`,
  ]
}

/**
 * Compact table summary for the settings page.
 * @param table - active rate table.
 * @param fx - CNY per USD, used only for the Grok display hint.
 * @returns one entry per vendor model.
 */
export function summarizeTable(table, fx) {
  const out = []
  for (const [vendor, entry] of Object.entries(table?.vendors ?? {})) {
    for (const [model, prices] of Object.entries(entry?.models ?? {})) {
      out.push({
        vendor: vendor === 'deepseek' ? 'DeepSeek' : vendor === 'xai' ? 'xAI' : vendor,
        model,
        currency: entry.currency,
        dimension: entry.dimension ?? null,
        lines: priceLines(vendor, model, prices, fx),
      })
    }
  }
  return out
}

/**
 * Register the plugin's four endpoints.
 * @param ctx - plugin context carrying `webServer`.
 * @param hooks - live state accessors used by the handlers.
 */
export function registerRoutes(ctx, hooks) {
  const route = (path, handler) => {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          if (!isLoopback(req)) {
            sendJson(res, 403, { ok: false, message: 'loopback only' })
            return
          }
          await handler(req, res)
        } catch (error) {
          sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
        }
      },
    }), `llm-cost route ${path}`)
  }

  route('/plugins/llm-cost/state', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, message: 'method not allowed' })
      return
    }
    sendJson(res, 200, { ok: true, ...hooks.describe() })
  })

  route('/plugins/llm-cost/settings', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, message: 'method not allowed' })
      return
    }
    const body = await readJson(req)
    await hooks.updateSettings({
      showPills: typeof body.showPills === 'boolean' ? body.showPills : undefined,
      showPerTurn: typeof body.showPerTurn === 'boolean' ? body.showPerTurn : undefined,
    })
    sendJson(res, 200, { ok: true, ...hooks.describe() })
  })

  route('/plugins/llm-cost/refresh', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, message: 'method not allowed' })
      return
    }
    const result = await hooks.refresh()
    sendJson(res, 200, { ok: true, ...result, ...hooks.describe() })
  })

  route('/plugins/llm-cost/reset', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, message: 'method not allowed' })
      return
    }
    await hooks.reset()
    sendJson(res, 200, { ok: true, ...hooks.describe() })
  })
}
