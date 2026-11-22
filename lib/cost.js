/**
 * Money math: integer-only conversion from token buckets to CNY micro-units
 * (1 unit = 0.000001 CNY), with half-up rounding at the sixth decimal and
 * trailing-zero trimming.
 */

/** One million tokens: every published price is quoted per this count. */
const PER_MILLION = 1000000

/**
 * Resolve which vendor family owns one provider/model route.
 * @param provider - provider id from the message source.
 * @param model - model id from the message source.
 * @returns 'deepseek', 'xai', or null when unknown.
 */
export function vendorOf(provider, model) {
  const p = String(provider ?? '').toLowerCase()
  const m = String(model ?? '').toLowerCase()
  if (p.includes('deepseek') || m.startsWith('deepseek')) return 'deepseek'
  if (p === 'xai' || p.startsWith('xai') || p.includes('grok') || m.startsWith('grok')) return 'xai'
  return null
}

/**
 * Convert one published price into milli-CNY per 1M tokens.
 * @param price - price in the vendor currency per 1M tokens.
 * @param currency - 'CNY' or 'USD'.
 * @param fx - CNY per USD, applied to USD prices only.
 * @returns integer milli-CNY (1 unit = 0.001 CNY).
 */
function milliCny(price, currency, fx) {
  const factor = currency === 'USD' ? fx * 1000 : 1000
  return BigInt(Math.round(Number(price) * factor))
}

/**
 * Unit prices for one segment, in milli-CNY per 1M tokens.
 * @param table - active rate table.
 * @param seg - one attempt segment (carries vendor, model, period, tier).
 * @param fx - CNY per USD.
 * @returns `{ input, cache, out }` integers, or null when the model is unpriced.
 */
export function priceUnit(table, seg, fx) {
  const vendor = table?.vendors?.[seg.v]
  if (!vendor || !seg.v) return null
  const entry = vendor.models?.[seg.m]
  if (!entry) return null
  if (seg.v === 'deepseek') {
    const period = seg.period === 'peak' ? 'peak' : 'off'
    const miss = entry.miss?.[period]
    const hit = entry.hit?.[period]
    const out = entry.out?.[period]
    if (miss === undefined || hit === undefined || out === undefined) return null
    return {
      input: milliCny(miss, vendor.currency, fx),
      cache: milliCny(hit, vendor.currency, fx),
      out: milliCny(out, vendor.currency, fx),
    }
  }
  const index = seg.tier === 'long' ? 1 : 0
  const tier = entry.tiers?.[index]
  if (!tier) return null
  return {
    input: milliCny(tier.input, vendor.currency, fx),
    cache: milliCny(tier.cacheRead, vendor.currency, fx),
    out: milliCny(tier.output, vendor.currency, fx),
  }
}

/**
 * Exact cost numerator for one segment: Σ tokens × milli-CNY price.
 *
 * `cost_micro_cny = numerator / 1000`, because a milli-CNY price per 1M tokens
 * divided by 1M tokens and scaled by 1e6 micro units leaves a factor of 1e-3.
 * @param seg - one attempt segment with u/r/w/o token buckets.
 * @param unit - `{ input, cache, out }` milli-CNY prices.
 * @returns integer numerator (BigInt).
 */
export function segmentNumerator(seg, unit) {
  const u = BigInt(seg.u || 0)
  const r = BigInt(seg.r || 0)
  const w = BigInt(seg.w || 0)
  const o = BigInt(seg.o || 0)
  // Cache writes carry no separate tariff on either vendor: they bill as input.
  return u * unit.input + w * unit.input + r * unit.cache + o * unit.out
}

/**
 * Round a cost numerator to whole micro-CNY, half up at the seventh decimal.
 * @param numerator - Σ tokens × milli-CNY price.
 * @returns integer micro-CNY (BigInt).
 */
export function roundMicro(numerator) {
  return (numerator + 500n) / 1000n
}

/**
 * Render integer micro-CNY as a plain decimal string with trailing zeros trimmed.
 * @param micro - integer micro-CNY.
 * @returns display text without a currency sign, e.g. `0.21868`, `1`, `0`.
 */
export function formatMicro(micro) {
  const negative = micro < 0n
  const value = negative ? -micro : micro
  const whole = value / 1000000n
  const fraction = (value % 1000000n).toString().padStart(6, '0').replace(/0+$/, '')
  const text = fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`
  return negative ? `-${text}` : text
}

/**
 * Display pair for one rounded cost: the text plus whether a nonzero cost is
 * too small to show at six decimals.
 * @param micro - integer micro-CNY.
 * @param numerator - the raw numerator it was rounded from.
 * @returns `{ cost, tiny }`.
 */
export function moneyOf(micro, numerator) {
  return { cost: formatMicro(micro), tiny: micro === 0n && numerator > 0n }
}

/** Token buckets at zero. */
export function zeroBuckets() {
  return { u: 0, r: 0, w: 0, o: 0 }
}

/** Sum four token buckets. */
export function addBuckets(target, source) {
  target.u += source.u || 0
  target.r += source.r || 0
  target.w += source.w || 0
  target.o += source.o || 0
  return target
}

export { PER_MILLION }
