/**
 * Beijing-time peak window for DeepSeek pricing.
 *
 * Official rule (zh page): 北京时间周一至周五 09:00-12:00、14:00-18:00 为高峰，
 * 其余时段（含周末与法定节假日）为空闲。这个插件按需求简化：不处理法定节假日
 * 与调休，只区分工作日与周末，因此节假日里的工作日会按高峰计价（偏高）。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** Peak windows as [startMinute, endMinute) in a Beijing day. */
export const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]

/**
 * Beijing wall-clock reading for one epoch millisecond value.
 * @param ms - epoch milliseconds.
 * @returns weekday (0 = Sunday) and minute of day.
 */
export function beijingClock(ms) {
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  return {
    weekday: shifted.getUTCDay(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

/**
 * Whether one request falls in DeepSeek's peak window.
 * @param ms - epoch milliseconds of the request settlement.
 * @returns true for a weekday inside a peak window.
 */
export function isDeepSeekPeak(ms) {
  const { weekday, minuteOfDay } = beijingClock(ms)
  if (weekday === 0 || weekday === 6) return false
  return PEAK_WINDOWS.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end)
}
