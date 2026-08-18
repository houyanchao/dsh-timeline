/**
 * 宿主深浅色主题探测：走 ui-theme 的官方服务面——apply 时由 index.ts 调用
 * bindTheme 绑定 ctx.theme（ThemeRuntime）快照并订阅 theme/change 事件，
 * 组件继续通过 detectDarkTheme / observeTheme 读取与订阅，不再监听 DOM
 * 信号（原实现读 boot 脚本写入的 html color-scheme / body 属性 +
 * MutationObserver，那是 ThemeRuntime 对外 DOM 投影，非正式接口）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

let dark = false
const listeners = new Set<() => void>()

/**
 * 绑定主题服务（index.ts 的 apply 中调用，早于任何组件挂载）。
 * 订阅经 ctx.on 注册，随插件 fiber 卸载自动解除；重载后重新绑定。
 * @param ctx - 注入了 theme 服务的客户端上下文。
 */
export function bindTheme(ctx: ClientContext): void {
  const sync = (snapshot: ThemeSnapshot): void => {
    const next = snapshot.active.colorScheme === 'dark'
    if (next === dark) return
    dark = next
    for (const fn of [...listeners]) fn()
  }
  sync(ctx.theme.getTheme())
  ctx.on('theme/change', sync)
}

/**
 * 当前是否深色主题。
 * @returns true 表示深色。
 */
export function detectDarkTheme(): boolean {
  return dark
}

/**
 * 订阅主题变化。
 * @param onChange - 主题变化时回调（回调内自行调用 detectDarkTheme）。
 * @returns 取消订阅。
 */
export function observeTheme(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}
