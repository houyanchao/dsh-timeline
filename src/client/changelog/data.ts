/**
 * Changelog 数据与已读状态（移植原 global/changelog-modal/changelog.js +
 * chrome.storage 的已读版本存储）。
 * 推送更新提示时只需修改 CHANGELOG_DATA：换 id、选 displayMode、更新条目。
 */
import { registerStorageSync } from '../shared/storageSync.ts'
import { Bus } from '../ui/bus.ts'

/** 双语条目（原 features/improvements 项）。 */
export interface ChangelogItem {
  readonly zh: string
  readonly en: string
}

/** 更新内容（原 CHANGELOG_DATA）。 */
export const CHANGELOG_DATA = {
  id: 'dsh-0.1.9',
  /** 'icon' = 提示词按钮旁 Logo + 小红点（温和提示）；'popup' = 自动弹窗（强提醒）。 */
  displayMode: 'icon' as 'icon' | 'popup',

  features: [
    {
      zh: '提示词面板和插件设置会在 npm 上有更高版本时显示更新提示。点击提示可打开 DSH 插件详情，在那里确认更新。',
      en: 'The prompt panel and plugin settings show an update badge when a newer version is available on npm. Click it to open the plugin details in DSH and confirm the update there.',
    },
  ] as readonly ChangelogItem[],

  improvements: [
    {
      zh: '修复新版 DSH 中侧栏和设置页的收藏项打不开的问题。整段会话可以直接打开，单条提问会跳转到对应位置。',
      en: 'Fixed starred items failing to open from the sidebar and settings in newer DSH versions. Full conversations open directly, and starred questions jump to the saved message.',
    },
    {
      zh: '恢复当前会话的收藏高亮。切换会话时会关闭上一段会话的浮层。',
      en: 'Restored highlighting for starred items in the current conversation. Switching conversations closes overlays from the previous conversation.',
    },
    {
      zh: '设置页和更新日志统一显示插件的实际版本号。',
      en: 'Plugin settings and the changelog now show the actual package version.',
    },
  ] as readonly ChangelogItem[],
}

/** 已读版本存储 key（原 ait-changelog-read-version）。 */
const STORAGE_KEY = 'dsh.timeline.changelog.readVersion'

function loadReadVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const readBus = new Bus<string | null>(loadReadVersion())

// 跨标签页同步（原 chrome.storage.onChanged 的等价物）。
registerStorageSync(STORAGE_KEY, () => { readBus.set(loadReadVersion()) })

/** 已读状态 store（供 Logo 按钮显隐订阅）。 */
export const changelogReadStore = {
  subscribe: readBus.subscribe,
  /** 是否有未读更新（原 hasUpdate）。 */
  hasUpdate(): boolean {
    const hasContent = CHANGELOG_DATA.features.length > 0 || CHANGELOG_DATA.improvements.length > 0
    if (CHANGELOG_DATA.id === '' || !hasContent) return false
    return readBus.get() !== CHANGELOG_DATA.id
  },
  /** 标记当前版本已读（原 _markAsRead）。 */
  markAsRead(): void {
    try {
      localStorage.setItem(STORAGE_KEY, CHANGELOG_DATA.id)
    } catch { /* 静默 */ }
    readBus.set(CHANGELOG_DATA.id)
  },
}
