/**
 * 宿主深浅色主题探测：解析 DSH 主题背景 token 的亮度判定 dark/light，
 * 供时间轴还原原扩展的深浅两套视觉参数（原版依据 html[data-timeline-theme]）。
 */

/**
 * 当前是否深色主题。
 * @returns true 表示深色。
 */
export function detectDarkTheme(): boolean {
  try {
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--dsw-alias-bg-base')
      .trim()
    const rgb = parseColor(bg)
    if (rgb !== null) {
      const [r, g, b] = rgb
      // 相对亮度低于 0.5 视为深色。
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5
    }
  } catch {
    // getComputedStyle 在极端环境可能失败，回退媒体查询。
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 订阅主题变化（监听 documentElement 属性变化 + 系统主题媒体查询）。
 * @param onChange - 主题可能变化时回调（回调内自行调用 detectDarkTheme）。
 * @returns 取消订阅。
 */
export function observeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true })
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  media?.addEventListener('change', onChange)
  return () => {
    observer.disconnect()
    media?.removeEventListener('change', onChange)
  }
}

function parseColor(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex !== null) {
    const num = parseInt(hex[1], 16)
    return [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF]
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value)
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  }
  return null
}
