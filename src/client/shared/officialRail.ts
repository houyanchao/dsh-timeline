/**
 * 隐藏宿主自带的轮次导航条（ui-chat 的 TurnNavigator）：它硬编码在 ChatView
 * 内部，没有槽位也没有设置项，插件只能用 CSS 盖掉。选择器不依赖哈希类名，
 * 而是用两条稳定契约：消息流列的 data-chat-flow 属性，以及轨道 <nav> 自带的
 * aria-label（轨道槽位是消息流列的前一个兄弟）。规则本体见
 * timeline.module.css 的 "宿主轮次导航" 段，由本模块通过根节点属性开关。
 *
 * 显隐跟随插件自己的 timelineEnabled：用户关掉插件时间轴时，宿主的轨道恢复。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { settingsStore } from './settings.ts'

/** 根节点开关属性（dataset 名 → html[data-dsh-tl-hide-rail]）。 */
const ROOT_FLAG = 'dshTlHideRail'

/**
 * 绑定宿主轨道隐藏（index.ts 的 apply 中调用）。
 * 随插件 fiber 卸载解除订阅并移除根属性，宿主轨道随之恢复。
 * @param ctx - 客户端上下文。
 */
export function bindOfficialRailHiding(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const sync = (): void => {
    if (settingsStore.get().timelineEnabled) root.dataset[ROOT_FLAG] = ''
    else delete root.dataset[ROOT_FLAG]
  }
  ctx.effect(() => {
    sync()
    const unsubscribe = settingsStore.subscribe(sync)
    return () => {
      unsubscribe()
      delete root.dataset[ROOT_FLAG]
    }
  }, 'dsh-timeline: hide host turn navigator')
}
