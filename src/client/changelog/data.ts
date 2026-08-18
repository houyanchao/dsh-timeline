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
  id: 'dsh-2026081801',
  /** 'icon' = 提示词按钮旁 Logo + 小红点（温和提示）；'popup' = 自动弹窗（强提醒）。 */
  displayMode: 'icon' as 'icon' | 'popup',

  features: [
    {
      zh: '时间轴导航：右侧轴条按提问定位，点击直达，支持 ↑ / ↓ 键跳转，长按节点标记重点',
      en: 'Timeline navigation: locate any question on the right-hand rail, jump with a click or the ↑ / ↓ keys, and long-press a node to mark it as a key point',
    },
    {
      zh: '收藏文件夹：整段对话、单条提问、闪记都能收进两级文件夹，拖拽即可整理',
      en: 'Starred folders: file whole conversations, single questions, and notes into two-level folders, and drag to reorganize',
    },
    {
      zh: '对话导出：支持 Markdown、TXT、JSON、CSV、PNG、PDF，数学公式照常渲染',
      en: 'Conversation export: Markdown, TXT, JSON, CSV, PNG, and PDF, with math formulas rendered as usual',
    },
    {
      zh: '复制公式：点击公式即可复制 LaTeX 或 MathML，可直接粘贴进 Word',
      en: 'Formula copy: click a formula to copy it as LaTeX or MathML, ready to paste into Word',
    },
    {
      zh: '提示词库：常用提示词存下来，在输入框旁一键调用',
      en: 'Prompt library: save frequently used prompts and insert them from beside the composer in one click',
    },
    {
      zh: '闪记：随手记录灵感，可归档到收藏文件夹',
      en: 'Notepad: jot down ideas at any time and file them into starred folders',
    },
    {
      zh: '输入增强：Enter 换行、双击 Enter 发送，选中文字可快速追问，发送后停在当前阅读位置',
      en: 'Composer enhancements: Enter for a new line, double Enter to send, quick follow-up from selected text, and no jump to the bottom after sending',
    },
    {
      zh: '提醒与备份：回复完成弹窗和声音提醒，插件数据一键导出导入',
      en: 'Alerts and backup: toast and sound when a reply finishes, plus one-click export and import of all plugin data',
    },
  ] as readonly ChangelogItem[],

  improvements: [] as readonly ChangelogItem[],
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
