/**
 * Changelog 数据与已读状态（移植原 global/changelog-modal/changelog.js +
 * chrome.storage 的已读版本存储）。
 * 推送更新提示时只需修改 CHANGELOG_DATA：换 id、选 displayMode、更新条目。
 */
import { Bus } from '../ui/bus.ts'

/** 双语条目（原 features/improvements 项）。 */
export interface ChangelogItem {
  readonly zh: string
  readonly en: string
}

/** 更新内容（原 CHANGELOG_DATA）。 */
export const CHANGELOG_DATA = {
  id: 'dsh-2026081601',
  /** 'icon' = 提示词按钮旁 Logo + 小红点（温和提示）；'popup' = 自动弹窗（强提醒）。 */
  displayMode: 'icon' as 'icon' | 'popup',

  features: [
    {
      zh: 'Timeline 全功能迁移至 DSH：时间轴、文件夹收藏、提示词库、智能回车、对话导出与设置面板',
      en: 'Full Timeline migration to DSH: timeline, starred folders, prompt library, smart enter, conversation export, and the settings panel',
    },
  ] as readonly ChangelogItem[],

  improvements: [
    {
      zh: '优化回复生成期间的滚动体验，减少页面自动跳转及长对话中手动滚动被误判的问题',
      en: 'Improved scrolling while responses are generated, reducing automatic jumps and misinterpreted manual scrolling in long conversations',
    },
  ] as readonly ChangelogItem[],
}

/** 已读版本存储 key（原 ait-changelog-read-version）。 */
const STORAGE_KEY = 'dsh-tl-changelog-read-version'

function loadReadVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const readBus = new Bus<string | null>(loadReadVersion())

// 跨标签页同步（原 chrome.storage.onChanged 的等价物）。
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) readBus.set(loadReadVersion())
})

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
