/**
 * Changelog 数据与已读状态（移植原 global/changelog-modal/changelog.js +
 * chrome.storage 的已读版本存储）。
 * 发布更新日志时修改 CHANGELOG_DATA 的 id 和条目。
 */

/** 双语条目（原 features/improvements 项）。 */
export interface ChangelogItem {
  readonly zh: string
  readonly en: string
}

/** 更新内容（原 CHANGELOG_DATA）。 */
export const CHANGELOG_DATA = {
  id: 'dsh-0.1.10',
  /** 'manual' 由设置页版本号打开，'popup' 自动打开未读更新日志。 */
  displayMode: 'manual' as 'manual' | 'popup',

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
    {
      zh: '检测到更高版本时，提示词图标会显示红点。点击图标打开提示词面板后，红点会消失，直到检测到下一个更高版本。',
      en: 'The Prompt Library icon shows a red dot when a newer version is available. Opening the Prompt Library clears the dot until a higher version is detected.',
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

/** 本地更新日志的已读状态。 */
export const changelogReadStore = {
  isUnread(): boolean {
    const hasContent = CHANGELOG_DATA.features.length > 0 || CHANGELOG_DATA.improvements.length > 0
    if (CHANGELOG_DATA.id === '' || !hasContent) return false
    return loadReadVersion() !== CHANGELOG_DATA.id
  },
  /** 标记当前版本已读（原 _markAsRead）。 */
  markAsRead(): void {
    try {
      localStorage.setItem(STORAGE_KEY, CHANGELOG_DATA.id)
    } catch { /* 静默 */ }
  },
}
