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
  id: 'dsh-0.1.10',
  /** 'icon' = 提示词按钮旁 Logo + 小红点（温和提示）；'popup' = 自动弹窗（强提醒）。 */
  displayMode: 'icon' as 'icon' | 'popup',

  features: [] as readonly ChangelogItem[],

  improvements: [
    {
      zh: '关闭时间轴后，仍可从对话顶部收藏整段会话或单条提问。',
      en: 'You can still star the conversation or individual questions from the conversation header when the timeline is off.',
    },
    {
      zh: '展开、收起或调整右侧栏宽度时，时间轴和折叠按钮会跟随对话区右边缘，避免遮挡任务管理等面板。',
      en: 'The timeline and its collapse button follow the right edge of the conversation as the right sidebar opens, closes, or resizes, keeping panels such as Task Management clear.',
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
