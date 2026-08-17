/**
 * 设置面板（panelModal）打开请求总线：各处入口（提示词下拉、收藏面板等）
 * 通过 panelModal.show(tab) 请求打开；面板宿主挂载后订阅消费。
 * 对应原 window.panelModal.show(tabId)。
 */
import { Bus } from '../ui/bus.ts'

/** 设置面板 Tab（原 panelModal tabs 目录中迁移到 DSH 的部分）。 */
export type PanelTab = 'timeline' | 'starred' | 'prompt' | 'smartInputBox' | 'formula' | 'export' | 'dataSync'

/** Tab 内深链子目标（原 TimelineSettingsTab.showAICompleteReminderModal 直开子弹窗）。 */
export type PanelSub = 'aiCompleteReminder'

/** 打开请求（seq 递增使重复打开同一 tab 也可被订阅方感知）。 */
export interface PanelRequest {
  readonly tab: PanelTab
  /** 打开后自动进入的子弹窗。 */
  readonly sub?: PanelSub
  readonly seq: number
}

const bus = new Bus<PanelRequest | null>(null)
let seq = 0

/** 设置面板命令式 API（原 window.panelModal 的最小面）。 */
export const panelModal = {
  subscribe: bus.subscribe,
  get: (): PanelRequest | null => bus.get(),
  show(tab: PanelTab, sub?: PanelSub): void {
    seq += 1
    bus.set({ tab, ...(sub !== undefined ? { sub } : {}), seq })
  },
  /** 面板宿主消费请求后清空。 */
  consume(): void {
    bus.set(null)
  },
}
