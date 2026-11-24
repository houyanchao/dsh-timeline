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
  id: 'dsh-0.1.14',
  /** 'manual' 由设置页版本号打开，'popup' 自动打开未读更新日志。 */
  displayMode: 'manual' as 'manual' | 'popup',

  features: [
    {
      zh: '关于插件页新增作者的其他插件，可直接安装 DSH 插件，也可打开 Chrome 或 Edge 商店。',
      en: 'Find more plugins by the author on the About tab. Install DSH plugins directly or open the Chrome and Edge stores.',
    },
  ] as readonly ChangelogItem[],

  improvements: [
    {
      zh: '免费模型推荐已更名为 dsh-open-model。安装按钮使用新包名，也能识别已安装的旧版。',
      en: 'The free models plugin is now dsh-open-model. The install button uses its new name and recognizes earlier installations.',
    },
    {
      zh: '更新提醒会在新版本发布满 24 小时后出现。',
      en: 'Update notifications appear once a new version has been published for 24 hours.',
    },
    {
      zh: '调整了关于插件页的排版，并将提示词按钮的默认背景改为透明。',
      en: 'Refined the About tab layout and made the prompt button background transparent.',
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
