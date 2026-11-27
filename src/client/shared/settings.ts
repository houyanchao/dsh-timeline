/**
 * 插件全局设置存储：集中承载原扩展 chrome.storage.local 上的各功能开关
 * （smartInputPlatformSettings / promptButtonPlatformSettings / smartEnterMode /
 * smartEnterToastCount / preventAutoScrollEnabled 等）。DSH 单平台，
 * 原按平台分键的设置折叠为单布尔。localStorage + Bus + storage 事件跨标签页同步。
 */
import { registerStorageSync } from './storageSync.ts'
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
  readonly messageScreenshotEnabled: boolean
  readonly screenshotScale: number
  readonly exportOptions?: {
    readonly formatId: string
    readonly themeId: string
    readonly showTime: boolean
    readonly showConversationTime: boolean
  }
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
  /** 从工作区原生列表隐藏已收藏的整段对话。 */
  readonly hideStarredFromNativeList: boolean
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
  messageScreenshotEnabled: true,
  screenshotScale: 2,
  chatTimeLabelEnabled: true,
  notepadEnabled: true,
  timelineEnabled: true,
  arrowKeysNavEnabled: true,
  aiCompleteToastEnabled: true,
  aiCompleteSoundEnabled: false,
  starredPanelEnabled: true,
  hideStarredFromNativeList: false,
  formulaLatexEnabled: true,
  formulaMathMLEnabled: false,
  formulaFormat: 'none',
}

export const SETTINGS_KEY = 'dsh.timeline.settings'
export const REMINDER_FIELDS = ['aiCompleteToastEnabled', 'aiCompleteSoundEnabled'] as const

// Keep failed writes in this tab, even when another tab subsequently triggers a reload.
const unsavedReminders: Partial<Record<typeof REMINDER_FIELDS[number], boolean>> = {}
let unsavedSettings: Partial<PluginSettings> = {}

function readBase(): Partial<PluginSettings> {
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (raw !== null) {
    try { return JSON.parse(raw) ?? {} } catch { /* Ignore damaged settings. */ }
  }
  return {}
}

function load(): PluginSettings {
  const result = { ...DEFAULTS, ...readBase(), ...unsavedSettings }
  for (const field of REMINDER_FIELDS) {
    const stored = localStorage.getItem(`${SETTINGS_KEY}.${field}`)
    const legacy = typeof result[field] === 'boolean' ? result[field] : DEFAULTS[field]
    const enabled = stored === 'true' || stored === 'false' ? stored === 'true' : legacy
    result[field] = unsavedReminders[field] ?? enabled
  }
  return result
}

const bus = new Bus<PluginSettings>(DEFAULTS)

function reload(fallback = bus.get()): void {
  let next: PluginSettings
  try { next = load() } catch { next = fallback }
  bus.set(next)
}

reload()
registerStorageSync(SETTINGS_KEY, reload)
for (const field of REMINDER_FIELDS) registerStorageSync(`${SETTINGS_KEY}.${field}`, reload)

/** 插件设置 API。 */
export const settingsStore = {
  subscribe: bus.subscribe,
  get: (): PluginSettings => bus.get(),
  set(patch: Partial<PluginSettings>): void {
    const ordinary = { ...patch }
    // A reminder toggle never writes the other tab's toggle or a stale settings snapshot.
    for (const field of REMINDER_FIELDS) {
      delete ordinary[field]
      const enabled = patch[field]
      if (typeof enabled !== 'boolean') continue
      try {
        localStorage.setItem(`${SETTINGS_KEY}.${field}`, String(enabled))
        delete unsavedReminders[field]
      } catch { unsavedReminders[field] = enabled }
    }
    if (Object.keys(ordinary).length > 0) {
      unsavedSettings = { ...unsavedSettings, ...ordinary }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readBase(), ...unsavedSettings }))
        unsavedSettings = {}
      } catch { /* Apply the patch in memory while storage is unavailable. */ }
    }
    reload({ ...bus.get(), ...patch })
  },
}
