/**
 * 激活色调色板（原 global/constants.js 的 ACTIVE_COLOR_PALETTE）：
 * 时间轴激活节点颜色与导出图片主题色共享同一来源。
 * 默认激活色为调色板第一项 black。
 */

/** 一个调色板条目：纯色或 135° 线性渐变。 */
export interface PaletteEntry {
  readonly id: string
  /** 纯色 hex。 */
  readonly solid?: string
  /** 渐变（angle 度 + [offset, color] 色标）。 */
  readonly gradient?: { readonly angle: number; readonly stops: readonly (readonly [number, string])[] }
}

/** 原 ACTIVE_COLOR_PALETTE（label 由 locale 提供）。 */
export const ACTIVE_COLOR_PALETTE: readonly PaletteEntry[] = [
  { id: 'black', solid: '#0d0d0d' },
  { id: 'blue', solid: '#3964fe' },
  { id: 'purple', solid: '#6128FF' },
  {
    id: 'gemini',
    gradient: { angle: 135, stops: [[0, '#4285F4'], [0.45, '#8E75FF'], [1, '#A142F4']] },
  },
]

/** 默认激活色：调色板第一项黑色（原 deepseek 平台默认为 blue，经确认改为 black）。 */
export const DEFAULT_ACTIVE_COLOR_ID = 'black'

/**
 * 调色板条目 → CSS color 值（原 activeColorPaletteToCss）。
 * @param entry - 调色板条目。
 * @returns 纯色 hex 或 linear-gradient 字符串。
 */
export function paletteEntryToCss(entry: PaletteEntry | undefined): string {
  if (entry === undefined) return ''
  if (entry.solid !== undefined) return entry.solid
  if (entry.gradient === undefined) return ''
  const { angle, stops } = entry.gradient
  const stopStr = stops.map(([offset, color]) => `${color} ${Math.round(offset * 100)}%`).join(', ')
  return `linear-gradient(${angle}deg, ${stopStr})`
}
