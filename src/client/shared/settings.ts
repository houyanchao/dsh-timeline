/**
 * 插件全局设置存储：集中承载原扩展 chrome.storage.local 上的各功能开关
 * （smartInputPlatformSettings / promptButtonPlatformSettings / smartEnterMode /
 * smartEnterToastCount / preventAutoScrollEnabled 等）。DSH 单平台，
 * 原按平台分键的设置折叠为单布尔。localStorage + Bus + storage 事件跨标签页同步。
 */
import { Bus } from '../ui/bus.ts'
import { DEFAULT_ACTIVE_COLOR_ID } from './palette.ts'

/** 智能回车发送模式（原 SMART_ENTER_MODES）。 */
export type SmartEnterMode = 'doubleEnter' | 'ctrlEnter' | 'shiftEnter'

/** 全部插件设置（缺省值与原扩展一致）。 */
export interface PluginSettings {
  /** 提示词按钮开关（原 promptButtonPlatformSettings[id] !== false，默认开）。 */
  readonly promptButtonEnabled: boolean
  /** 智能回车开关（原 smartInputPlatformSettings[id] === true，默认关）。 */
  readonly smartEnterEnabled: boolean
  /** 智能回车发送模式（原 smartEnterMode，默认 doubleEnter）。 */
  readonly smartEnterMode: SmartEnterMode
  /** 换行提示 toast 已展示次数（原 smartEnterToastCount，上限 5 次）。 */
  readonly smartEnterToastCount: number
  /** 阻止发送后跳底（原 preventAutoScrollEnabled !== false，默认开）。 */
  readonly preventAutoScrollEnabled: boolean
  /** 追问功能开关（原 quickAskEnabled !== false，默认开）。 */
  readonly quickAskEnabled: boolean
  /** 时间轴激活色 id（原 timelineActiveColors[platform]，默认调色板第一项 black）。 */
  readonly activeColorId: string
  /** 对话导出开关（原 conversationExportPlatformSettings[id] !== false，默认开）。 */
  readonly conversationExportEnabled: boolean
  /** 消息旁时间标签开关（原 chatTimeLabelEnabled !== false，默认开）。 */
  readonly chatTimeLabelEnabled: boolean
  /** 闪记开关（原 aitNotepadEnabled !== false，默认开）。 */
  readonly notepadEnabled: boolean
  /** 显示时间轴开关（原 timelinePlatformSettings[id] !== false，默认开）。 */
  readonly timelineEnabled: boolean
  /** ↑/↓ 键节点导航开关（原 arrowKeysNavigationEnabled !== false，默认开）。 */
  readonly arrowKeysNavEnabled: boolean
  /** AI 回复完成弹窗提醒（原 timelineAICompleteToastEnabled !== false，默认开）。 */
  readonly aiCompleteToastEnabled: boolean
  /** AI 回复完成声音提醒（原 timelineAICompleteSoundEnabled === true，默认关）。 */
  readonly aiCompleteSoundEnabled: boolean
  /** 侧栏收藏面板开关（原 sidebarStarredPlatformSettings[id] !== false，默认开）。 */
  readonly starredPanelEnabled: boolean
  /** 公式复制：LaTeX 开关（原 formulaLatexEnabled !== false，默认开）。 */
  readonly formulaLatexEnabled: boolean
  /** 公式复制：MathML 开关（原 formulaMathMLEnabled === true，默认关）。 */
  readonly formulaMathMLEnabled: boolean
  /** 公式复制：LaTeX 复制格式 id（原 formulaFormat，默认 none）。 */
  readonly formulaFormat: string
}

const DEFAULTS: PluginSettings = {
  promptButtonEnabled: true,
  smartEnterEnabled: false,
  smartEnterMode: 'doubleEnter',
  smartEnterToastCount: 0,
  preventAutoScrollEnabled: true,
  quickAskEnabled: true,
  activeColorId: DEFAULT_ACTIVE_COLOR_ID,
  conversationExportEnabled: true,
  chatTimeLabelEnabled: true,
  notepadEnabled: true,
  timelineEnabled: true,
  arrowKeysNavEnabled: true,
  aiCompleteToastEnabled: true,
  aiCompleteSoundEnabled: false,
  starredPanelEnabled: true,
  formulaLatexEnabled: true,
  formulaMathMLEnabled: false,
  formulaFormat: 'none',
}

const STORAGE_KEY = 'dsh.timeline.settings'

function load(): PluginSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PluginSettings>
      return { ...DEFAULTS, ...parsed }
    }
  } catch { /* 损坏数据回退默认 */ }
  return DEFAULTS
}

const bus = new Bus<PluginSettings>(load())

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) bus.set(load())
  })
}

/** 插件设置 API。 */
export const settingsStore = {
  subscribe: bus.subscribe,
  get: (): PluginSettings => bus.get(),
  set(patch: Partial<PluginSettings>): void {
    const next = { ...bus.get(), ...patch }
    bus.set(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
  },
}
