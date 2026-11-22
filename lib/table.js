/**
 * Built-in rate table: DeepSeek priced in CNY exactly as the official
 * Chinese price page lists it (no FX conversion), Grok priced in USD and
 * converted at the configured fixed FX rate.
 *
 * Sources (2026-11-22):
 *   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 *   https://docs.x.ai/developers/pricing
 */

export const TABLE_VERSION = 2

/** Prices are per 1,000,000 tokens in the vendor's own currency. */
export const BUILTIN_TABLE = {
  version: TABLE_VERSION,
  source: 'builtin',
  fetchedAt: '2026-11-22T00:00:00.000Z',
  vendors: {
    deepseek: {
      currency: 'CNY',
      unit: 1000000,
      dimension: 'period',
      /** Beijing time, Monday-Friday only; weekend is always off-peak. */
      peakWindows: [[540, 720], [840, 1080]],
      models: {
        'deepseek-flash': {
          hit: { off: 0.02, peak: 0.04 },
          miss: { off: 1, peak: 2 },
          out: { off: 4, peak: 8 },
        },
        /**
         * The current Chinese pricing page documents these retired aliases as
         * still callable and billed at the deepseek-flash rate.
         */
        'deepseek-v4-flash': {
          hit: { off: 0.02, peak: 0.04 },
          miss: { off: 1, peak: 2 },
          out: { off: 4, peak: 8 },
        },
        'deepseek-v4-flash-vision-exp': {
          hit: { off: 0.02, peak: 0.04 },
          miss: { off: 1, peak: 2 },
          out: { off: 4, peak: 8 },
        },
        'deepseek-v4-pro': {
          hit: { off: 0.15, peak: 0.3 },
          miss: { off: 4.5, peak: 9 },
          out: { off: 13.5, peak: 27 },
        },
      },
    },
    xai: {
      currency: 'USD',
      unit: 1000000,
      dimension: 'tier',
      /** Prompt tokens at or above this value switch the whole request to the long tier. */
      tierThreshold: 200000,
      models: {
        'grok-4.7': {
          tiers: [
            { input: 2, cacheRead: 0.5, output: 6 },
            { input: 4, cacheRead: 1, output: 12 },
          ],
        },
        'grok-4.6': {
          tiers: [
            { input: 2, cacheRead: 0.5, output: 6 },
            { input: 4, cacheRead: 1, output: 12 },
          ],
        },
        'grok-4.5': {
          tiers: [
            { input: 2, cacheRead: 0.3, output: 6 },
            { input: 4, cacheRead: 0.6, output: 12 },
          ],
        },
        'grok-4.3': {
          tiers: [
            { input: 1.25, cacheRead: 0.2, output: 2.5 },
            { input: 2.5, cacheRead: 0.4, output: 5 },
          ],
        },
        'grok-build-0.1': {
          tiers: [
            { input: 1, cacheRead: 0.2, output: 2 },
            { input: 2, cacheRead: 0.4, output: 4 },
          ],
        },
        'grok-4.20-0309-reasoning': {
          tiers: [
            { input: 1.25, cacheRead: 0.2, output: 2.5 },
            { input: 2.5, cacheRead: 0.4, output: 5 },
          ],
        },
        'grok-4.20-0309-non-reasoning': {
          tiers: [
            { input: 1.25, cacheRead: 0.2, output: 2.5 },
            { input: 2.5, cacheRead: 0.4, output: 5 },
          ],
        },
        'grok-4.20-multi-agent-0309': {
          tiers: [
            { input: 1.25, cacheRead: 0.2, output: 2.5 },
            { input: 2.5, cacheRead: 0.4, output: 5 },
          ],
        },
      },
    },
  },
}

/** Fixed FX used only for USD vendors (Grok). DeepSeek never converts. */
export const DEFAULT_FX = 6.7
