/**
 * 宿主深浅色主题探测：读 DSH 的权威主题信号——boot-theme 内联脚本与
 * ui-layout ThemePresenter 成对维护的 html `style.color-scheme` 和
 * body `data-ds-dark-theme`，供时间轴还原原扩展的深浅两套视觉参数
 * （原版依据 html[data-timeline-theme]）。
 * 注意不要用背景 token 判亮度：宿主 token 全部声明在 body 作用域，
 * html 上读不到；也不要用 prefers-color-scheme：那是系统偏好，
 * 与 DSH 自己的主题设置可以不一致。
 */

/** ThemePresenter 切深色时打在 body 上的属性（ui-layout 的 DARK_ATTRIBUTE）。 */
const DARK_BODY_ATTRIBUTE = 'data-ds-dark-theme'

/**
 * 当前是否深色主题。
 * @returns true 表示深色。
 */
export function detectDarkTheme(): boolean {
  // 双信号成对写入，boot 脚本先于插件执行，任何时刻读都不会扑空。
  const scheme = document.documentElement.style.colorScheme
  if (scheme === 'dark') return true
  if (scheme === 'light') return false
  if (document.body.hasAttribute(DARK_BODY_ATTRIBUTE)) return true
  // 信号缺失（理论上只在宿主主题插件被卸载时发生）：退回系统偏好。
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
