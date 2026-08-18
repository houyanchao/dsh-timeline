/**
 * 设置面板（移植原 panelModal）：居中弹窗、左侧 tab 栏 + 右侧内容区。
 * Tab：时间轴 / 文件夹 / 提示词 / 输入框 / 复制公式 / 对话导出 / 数据同步
 * （原 chrome 专属的 about/highlight/animation/runner 不在 DSH 迁移范围）。
 * 原按平台分组的开关（platform modal）在 DSH 单平台下折叠为单行开关。
 * 通过 panelModal.show(tab) 总线打开；遮罩点击 / 关闭按钮关闭。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { settingsStore, type SmartEnterMode } from '../shared/settings.ts'
import { ACTIVE_COLOR_PALETTE, DEFAULT_ACTIVE_COLOR_ID, paletteEntryToCss } from '../shared/palette.ts'
import { playAiCompleteSound, showAiCompleteToast } from '../shared/aiCompleteReminder.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import { dropdown } from '../ui/dropdown.tsx'
import { popconfirm } from '../ui/popconfirm.tsx'
import { promptsStore, sortPrompts, type Prompt } from '../smartInputBox/storage.ts'
import { StarredTree } from '../starred/StarredTree.tsx'
import { createFolderFlow } from '../starred/actions.tsx'
import { notepad } from '../notepad/NotepadPanel.tsx'
import { FORMULA_FORMATS } from '../formula/formats.ts'
import { changelogModal } from '../changelog/ChangelogModal.tsx'
import { CHANGELOG_DATA } from '../changelog/data.ts'
import { DEEPSEEK_LOGO_DATA_URL } from '../shared/deepseekLogo.ts'
import { panelModal, type PanelTab } from './bus.ts'
import { exportDataToFile, isValidBackup, mergeData, overwriteData } from './dataSync.ts'
import css from './panel.module.css'

type T = TranslateNS<typeof NS>

/** 插件版本（原 footer 显示 chrome.runtime.getManifest().version）。 */
const VERSION = '0.1.0'
/** 分享按钮跳转地址（原 _getStoreDetailUrl 的商店详情页；DSH 无商店，指向 GitHub）。 */
const SHARE_URL = 'https://github.com/houyanchao/dsh-timeline'

/** PanelHost props（词典 + 收藏 tab 导航所需）。 */
export interface PanelHostProps {
  readonly t: T
  readonly currentSessionId: string | undefined
  readonly openSession: (sessionId: string) => void
}

/** 「标记重点」提示 toast 的黑白反色（原 TimelineSettingsTab 内联色值；黑底改取宿主 tooltip 底板 token）。 */
const MARK_LOCKED_TOAST_COLOR = {
  light: { backgroundColor: 'var(--dsw-alias-tooltip-bg)', textColor: '#ffffff', borderColor: 'var(--dsw-alias-tooltip-bg)' },
  dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
}

/** Mac 判定（原 SmartInputBoxTab._isMac）。 */
const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
const CTRL_LABEL = IS_MAC ? '⌘' : 'Ctrl'

/** Tab 定义（顺序对齐原 TAB_CONFIG 中迁移的部分；about 置首）。 */
const TABS: readonly { id: PanelTab; labelKey: 'panel.tabAbout' | 'panel.tabTimeline' | 'panel.tabStarred' | 'panel.tabPrompt' | 'panel.tabSmartInput' | 'panel.tabFormula' | 'panel.tabExport' | 'panel.tabDataSync'; icon: React.ReactNode }[] = [
  {
    id: 'about',
    labelKey: 'panel.tabAbout',
    icon: (
      // 原 AboutTab 图标：圆圈 i。
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="8" strokeWidth="3" strokeLinecap="round" />
        <line x1="12" y1="12" x2="12" y2="16" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'timeline',
    labelKey: 'panel.tabTimeline',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    id: 'starred',
    labelKey: 'panel.tabStarred',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'prompt',
    labelKey: 'panel.tabPrompt',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    id: 'smartInputBox',
    labelKey: 'panel.tabSmartInput',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'formula',
    labelKey: 'panel.tabFormula',
    icon: (
      // 原 FormulaTab 图标未设 linecap/linejoin（平角笔画）。
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M14 3H4l5 8-5 8h10" />
        <path d="M14 15l3 3 5-6" />
      </svg>
    ),
  },
  {
    id: 'export',
    labelKey: 'panel.tabExport',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
  {
    id: 'dataSync',
    labelKey: 'panel.tabDataSync',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M16 3l4 4-4 4" />
        <path d="M20 7H4" />
        <path d="M8 21l-4-4 4-4" />
        <path d="M4 17h16" />
      </svg>
    ),
  },
]

/**
 * 设置面板宿主：订阅 panelModal 总线，打开时渲染面板。
 * @param props - 词典 + 会话导航。
 * @returns 面板或 null。
 */
export function PanelHost({ t, currentSessionId, openSession }: PanelHostProps) {
  const request = useSyncExternalStore(panelModal.subscribe, () => panelModal.get())
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('timeline')
  // 深链子弹窗请求计数（>0 时 TimelineTab 自动打开提醒子弹窗，seq 变化可重复触发）。
  const [reminderSeq, setReminderSeq] = useState(0)

  // 消费打开请求（原 window.panelModal.show(tabId)）。
  useEffect(() => {
    if (request === null) return
    setActiveTab(request.tab)
    if (request.sub === 'aiCompleteReminder') setReminderSeq(s => s + 1)
    setOpen(true)
    panelModal.consume()
  }, [request])

  // 会话切换时自动关闭面板（原 url:change 分支）。
  const prevSessionRef = useRef(currentSessionId)
  useEffect(() => {
    if (prevSessionRef.current === currentSessionId) return
    prevSessionRef.current = currentSessionId
    setOpen(false)
  }, [currentSessionId])

  // 打开期间禁用 body 滚动（原 show/hide 的 overflow 处理）。
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  const close = (): void => {
    tooltip.forceHideAll()
    setOpen(false)
  }

  return (
    <div className={css.modal}>
      <div className={css.overlay} onClick={close} />
      <div className={css.wrapper}>
        {/* ===== 左侧边栏 ===== */}
        <div className={css.sidebar}>
          <div className={css.sidebarHeader}>
            <button type="button" className={css.close} aria-label={t('common.cancel')} onClick={close}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <span className={css.sidebarTitle}>{t('panel.sidebarTitle')}</span>
          </div>
          <div className={css.tabs}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === activeTab ? `${css.tab} ${css.tabActive}` : css.tab}
                aria-label={t(tab.labelKey)}
                onClick={() => { setActiveTab(tab.id) }}
              >
                <span className={css.tabIcon}>{tab.icon}</span>
                <span className={css.tabLabel}>{t(tab.labelKey)}</span>
              </button>
            ))}
          </div>
          <div className={css.footer}>
            {/* 有更新日志数据时版本号可点击打开更新弹窗（原 footer-version click）。 */}
            <div
              className={css.footerVersion}
              {...(CHANGELOG_DATA.id !== ''
                ? {
                    style: { cursor: 'pointer' } as React.CSSProperties,
                    onClick: () => { changelogModal.show() },
                  }
                : {})}
            >
              {`v${VERSION}`}
            </div>
          </div>
        </div>
        {/* ===== 右侧主区域 ===== */}
        <div className={css.main}>
          <div className={css.header}>
            <h2 className={css.title}>{t(TABS.find(tab => tab.id === activeTab)?.labelKey ?? 'panel.tabTimeline')}</h2>
            {/* 头部动作区（原 header-actions；语言切换由宿主 locale 服务承担，不迁移）。 */}
            <button
              type="button"
              className={css.shareBtn}
              aria-label="Timeline"
              onMouseEnter={(e) => {
                tooltip.showOverlay(e.currentTarget, t('prompt.share'), { placement: 'bottom' })
              }}
              onMouseLeave={() => { tooltip.hideOverlay() }}
              onClick={(e) => {
                e.stopPropagation()
                window.open(SHARE_URL, '_blank', 'noopener,noreferrer')
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.59 13.51 15.42 17.49" />
                <path d="M15.41 6.51 8.59 10.49" />
              </svg>
            </button>
          </div>
          <div className={css.content}>
            {activeTab === 'about' ? <AboutTab t={t} /> : null}
            {activeTab === 'timeline' ? <TimelineTab t={t} reminderSeq={reminderSeq} /> : null}
            {activeTab === 'starred'
              ? (
                <StarredTab
                  t={t}
                  currentSessionId={currentSessionId}
                  openSession={openSession}
                  onClose={close}
                />
              )
              : null}
            {activeTab === 'prompt' ? <PromptTab t={t} /> : null}
            {activeTab === 'smartInputBox' ? <SmartInputTab t={t} /> : null}
            {activeTab === 'formula' ? <FormulaTab t={t} /> : null}
            {activeTab === 'export' ? <ExportTab t={t} /> : null}
            {activeTab === 'dataSync' ? <DataSyncTab t={t} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== 通用小部件 ====================

interface ToggleProps {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

/** 开关（原 .ait-toggle-switch）。 */
function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <label className={css.toggle}>
      <input type="checkbox" checked={checked} onChange={(e) => { onChange(e.target.checked) }} />
      <span className={css.toggleSlider} />
    </label>
  )
}

interface SettingItemProps {
  readonly label: React.ReactNode
  readonly hint: React.ReactNode
  readonly control: React.ReactNode
}

/** 设置行（原 .setting-item）。 */
function SettingItem({ label, hint, control }: SettingItemProps) {
  return (
    <div className={css.settingItem}>
      <div className={css.settingInfo}>
        <div className={css.settingLabel}>{label}</div>
        <div className={css.settingHint}>{hint}</div>
      </div>
      {control}
    </div>
  )
}

interface SubModalProps {
  readonly title: string
  readonly variant?: 'theme' | 'reminder'
  readonly onClose: () => void
  readonly children: React.ReactNode
}

/** 子弹窗（原 .starred-platform-modal）。 */
function SubModal({ title, variant, onClose, children }: SubModalProps) {
  return (
    <div
      className={css.subModalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={[
          css.subModal,
          variant === 'theme' ? css.subModalTheme : '',
          variant === 'reminder' ? css.subModalReminder : '',
        ].filter(Boolean).join(' ')}
      >
        <div className={css.subModalHeader}>
          <span>{title}</span>
          <button type="button" className={css.subModalClose} onClick={onClose}>✕</button>
        </div>
        <div className={css.subModalBody}>{children}</div>
      </div>
    </div>
  )
}

/** DeepSeek 平台行头（原 platform logo img + name；DSH 单平台固定）。 */
function PlatformInfo() {
  return (
    <div className={css.subPlatformInfo}>
      <div className={css.subPlatformLogo}>
        <img src={DEEPSEEK_LOGO_DATA_URL} alt="DeepSeek" />
      </div>
      <span className={css.subPlatformName}>DeepSeek</span>
    </div>
  )
}

// ==================== 关于插件 tab ====================

/** 原 AboutTab 的各外链（商店/文档/仓库）与反馈邮箱。 */
const ABOUT_LINKS = {
  docs: 'https://timeline4ai.com/#/guide?section=timeline',
  chrome: 'https://chromewebstore.google.com/detail/fgebdnlceacaiaeikopldglhffljjlhh?utm_source=item-share-cb',
  edge: 'https://microsoftedge.microsoft.com/addons/detail/ai-timeline%EF%BC%9Agemini%E3%80%81chatgp/ekednjjojnhlajfobalaaihkibbdcbab',
  firefox: 'https://addons.mozilla.org/en-US/firefox/addon/ai-timeline/',
  github: 'https://github.com/houyanchao/dsh-timeline',
  issues: 'https://github.com/houyanchao/dsh-timeline/issues',
  email: 'houyanchao@outlook.com',
} as const

/** 当前浏览器对应的商店入口（Edge UA 含 Chrome，须先判 Edge）。 */
function detectBrowserStore(): { readonly href: string; readonly icon: React.ReactNode } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Edg/i.test(ua)) {
    return {
      href: ABOUT_LINKS.edge,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M16.24 7.76a6 6 0 010 8.49m-8.48-.01a6 6 0 010-8.49" />
        </svg>
      ),
    }
  }
  if (/Firefox/i.test(ua)) {
    return {
      href: ABOUT_LINKS.firefox,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zM17.9 17.39c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41C18.93 5.77 22 8.65 22 12c0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      ),
    }
  }
  return {
    href: ABOUT_LINKS.chrome,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="21.17" y1="8" x2="12" y2="8" />
        <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
        <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
      </svg>
    ),
  }
}

/** 关于插件 tab（移植原 tabs/about：分享按钮组 + 简介/数据安全/提需求）。 */
function AboutTab({ t }: { readonly t: T }) {
  const browserStore = detectBrowserStore()
  const copyEmail = (): void => {
    void navigator.clipboard.writeText(ABOUT_LINKS.email).then(() => {
      toast.success(t('about.copied'))
    })
  }

  return (
    <div className={css.aboutTab}>
      {/* 分享操作按钮组（原 about-share-actions） */}
      <div className={css.aboutShareActions}>
        <a href={ABOUT_LINKS.docs} target="_blank" rel="noopener noreferrer" className={css.aboutShareActionBtn}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
          {t('about.btnDocs')}
        </a>
        <a href={ABOUT_LINKS.github} target="_blank" rel="noopener noreferrer" className={css.aboutShareActionBtn}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" /></svg>
          {t('about.btnGithub')}
        </a>
        <a href={browserStore.href} target="_blank" rel="noopener noreferrer" className={css.aboutShareActionBtn}>
          {browserStore.icon}
          {t('about.btnBrowser')}
        </a>
      </div>

      {/* 插件简介 */}
      <div className={css.aboutSection}>
        <div className={css.aboutSectionIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden>
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
            <polyline points="13,2 13,9 20,9" />
          </svg>
        </div>
        <div className={css.aboutSectionBody}>
          <div className={css.aboutSectionTitle}>{t('about.pluginTitle')}</div>
          <div className={css.aboutSectionContent}>{t('about.pluginContent')}</div>
        </div>
      </div>

      {/* 数据安全 */}
      <div className={css.aboutSection}>
        <div className={css.aboutSectionIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div className={css.aboutSectionBody}>
          <div className={css.aboutSectionTitle}>{t('about.dataSecurityTitle')}</div>
          <div className={css.aboutSectionContent}>{t('about.dataSecurityContent')}</div>
        </div>
      </div>

      {/* 提需求（含反馈渠道块） */}
      <div className={css.aboutSection}>
        <div className={css.aboutSectionIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden>
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className={css.aboutSectionBody}>
          <div className={css.aboutSectionTitle}>{t('about.developerTitle')}</div>
          <div className={css.aboutSectionContent}>
            {t('about.developerContent')}
            <div className={css.aboutFeedbackBlocks}>
              <a href={ABOUT_LINKS.issues} target="_blank" rel="noopener noreferrer" className={css.aboutFeedbackBlock}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" /></svg>
                <span>{t('about.feedbackGithub')}</span>
              </a>
              <button type="button" className={css.aboutFeedbackBlock} onClick={copyEmail}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                <span>{t('about.feedbackEmail')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== 时间轴 tab ====================

function TimelineTab({ t, reminderSeq = 0 }: { readonly t: T; readonly reminderSeq?: number }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [reminderModalOpen, setReminderModalOpen] = useState(false)

  // 深链：panelModal.show('timeline', 'aiCompleteReminder') 时自动打开提醒子弹窗
  // （对齐原 TimelineSettingsTab.showAICompleteReminderModal 直开行为）。
  useEffect(() => {
    if (reminderSeq > 0) setReminderModalOpen(true)
  }, [reminderSeq])

  const selectedColorId = ACTIVE_COLOR_PALETTE.some(entry => entry.id === settings.activeColorId)
    ? settings.activeColorId
    : DEFAULT_ACTIVE_COLOR_ID

  return (
    <div className={css.settingsRoot}>
      <div className={css.settingsScroll}>
        {/* 显示时间轴（DSH 单平台，开关直接内联；置于内容区首位） */}
        <div className={css.settingSection}>
          <SettingItem
            label={t('panel.timelineDisplayLabel')}
            hint={t('panel.timelineDisplayHint')}
            control={(
              <Toggle
                checked={settings.timelineEnabled}
                onChange={(enabled) => { settingsStore.set({ timelineEnabled: enabled }) }}
              />
            )}
          />
        </div>
        <div className={css.divider} />
        {/* 显示对话时间 */}
        <div className={css.settingSection}>
          <SettingItem
            label={t('panel.chatTimeTitle')}
            hint={t('panel.chatTimeHint')}
            control={(
              <Toggle
                checked={settings.chatTimeLabelEnabled}
                onChange={(enabled) => { settingsStore.set({ chatTimeLabelEnabled: enabled }) }}
              />
            )}
          />
        </div>
        <div className={css.divider} />
        {/* 时间轴主题色 */}
        <div className={css.settingSection}>
          <SettingItem
            label={t('panel.themeColorLabel')}
            hint={t('panel.themeColorHint')}
            control={(
              <button type="button" className={css.manageBtn} onClick={() => { setThemeModalOpen(true) }}>
                {t('panel.settingsBtn')}
              </button>
            )}
          />
        </div>
        <div className={css.divider} />
        {/* AI 回复完成提醒 */}
        <div className={css.settingSection}>
          <SettingItem
            label={t('panel.aiCompleteTitle')}
            hint={t('panel.aiCompleteHint')}
            control={(
              // 原按钮走 sidebarStarredManage 词条（en "Settings"），与主题色按钮（en "Set"）不同。
              <button type="button" className={css.manageBtn} onClick={() => { setReminderModalOpen(true) }}>
                {t('panel.reminderSettingsBtn')}
              </button>
            )}
          />
        </div>
        <div className={css.divider} />
        {/* 阻止发送后跳到底部 */}
        <div className={css.settingSection}>
          <SettingItem
            label={t('panel.pasLabel')}
            hint={t('panel.pasHint')}
            control={(
              <Toggle
                checked={settings.preventAutoScrollEnabled}
                onChange={(enabled) => { settingsStore.set({ preventAutoScrollEnabled: enabled }) }}
              />
            )}
          />
        </div>
        <div className={css.divider} />
        {/* 标记重点对话（默认开启，无法关闭） */}
        <div className={css.settingSection}>
          <SettingItem
            label={(
              <>
                <svg className={css.settingLabelIcon} viewBox="0 0 24 24" fill="rgb(255, 125, 3)" stroke="rgb(255, 125, 3)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                </svg>
                {t('panel.markTitle')}
              </>
            )}
            hint={t('panel.markHint')}
            control={(
              <MarkLockedToggle t={t} />
            )}
          />
        </div>
        <div className={css.divider} />
        {/* 闪记 */}
        <div className={css.settingSection}>
          <SettingItem
            label={t('notepad.title')}
            hint={t('panel.notepadHint')}
            control={(
              <Toggle
                checked={settings.notepadEnabled}
                onChange={(enabled) => {
                  settingsStore.set({ notepadEnabled: enabled })
                  // 关闭时同时收起面板（原 notepad-toggle change 分支）。
                  if (!enabled && notepad.isOpen()) notepad.close()
                }}
              />
            )}
          />
        </div>
        <div className={css.divider} />
        {/* ↑/↓ 键跳转 */}
        <div className={css.settingSection}>
          <SettingItem
            label={t('panel.arrowNavTitle')}
            hint={t('panel.arrowNavHint')}
            control={(
              <Toggle
                checked={settings.arrowKeysNavEnabled}
                onChange={(enabled) => { settingsStore.set({ arrowKeysNavEnabled: enabled }) }}
              />
            )}
          />
        </div>
      </div>

      {/* 主题色子弹窗（原 _showThemeColorModal，DSH 单平台一行） */}
      {themeModalOpen
        ? (
          <SubModal title={t('panel.themeColorLabel')} variant="theme" onClose={() => { setThemeModalOpen(false) }}>
            <div className={css.themeColorItem}>
              <PlatformInfo />
              <div className={css.colorOptions} aria-label={t('panel.themeColorLabel')}>
                {ACTIVE_COLOR_PALETTE.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    className={entry.id === selectedColorId ? `${css.colorBtn} ${css.colorBtnSelected}` : css.colorBtn}
                    style={{ '--panel-color-option': paletteEntryToCss(entry) } as React.CSSProperties}
                    aria-label={`${t('panel.themeColorLabel')} ${paletteEntryToCss(entry)}`}
                    aria-pressed={entry.id === selectedColorId}
                    onClick={() => { settingsStore.set({ activeColorId: entry.id }) }}
                  />
                ))}
              </div>
            </div>
          </SubModal>
        )
        : null}

      {/* AI 完成提醒子弹窗（原 showAICompleteReminderModal） */}
      {reminderModalOpen
        ? (
          <SubModal title={t('panel.aiCompleteTitle')} variant="reminder" onClose={() => { setReminderModalOpen(false) }}>
            <div className={css.reminderItem}>
              <div className={css.reminderInfo}>
                <div className={css.reminderLabel}>{t('panel.aiCompleteToastTitle')}</div>
                <div className={css.reminderHint}>{t('panel.aiCompleteToastHint')}</div>
              </div>
              <Toggle
                checked={settings.aiCompleteToastEnabled}
                onChange={(enabled) => {
                  settingsStore.set({ aiCompleteToastEnabled: enabled })
                  // 开启时预览效果（原 showAICompleteToastPreview）。
                  if (enabled) showAiCompleteToast(t('timeline.aiCompleteToast'))
                }}
              />
            </div>
            <div className={css.reminderItem}>
              <div className={css.reminderInfo}>
                <div className={css.reminderLabel}>{t('panel.aiCompleteSoundTitle')}</div>
                <div className={css.reminderHint}>{t('panel.aiCompleteSoundHint')}</div>
              </div>
              <Toggle
                checked={settings.aiCompleteSoundEnabled}
                onChange={(enabled) => {
                  // 开启时预览音效（原 playAICompleteSoundPreview）。
                  if (enabled) playAiCompleteSound()
                  settingsStore.set({ aiCompleteSoundEnabled: enabled })
                }}
              />
            </div>
          </SubModal>
        )
        : null}

    </div>
  )
}

/** 「标记重点」不可关闭开关：change 时保持开启并 toast 提示（原逻辑）。 */
function MarkLockedToggle({ t }: { readonly t: T }) {
  return (
    <label className={css.toggle}>
      <input
        type="checkbox"
        checked
        onChange={(e) => {
          // 原版 toast 锚点为隐藏 checkbox 自身（e.target），非整个开关。
          toast.info(t('panel.markLocked'), e.target, {
            duration: 2200,
            icon: '',
            color: MARK_LOCKED_TOAST_COLOR,
          })
        }}
      />
      <span className={css.toggleSlider} />
    </label>
  )
}

// ==================== 文件夹 tab ====================

/** 收藏 tab 内树操作 toast 的配色（原 StarredTab 注入的 toastOptions.color；黑底改取宿主 tooltip 底板 token）。 */
const STARRED_TAB_TOAST_COLOR = {
  light: { backgroundColor: 'var(--dsw-alias-tooltip-bg)', textColor: '#ffffff', borderColor: 'var(--dsw-alias-tooltip-bg)' },
  dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#d1d5db' },
}

interface StarredTabProps {
  readonly t: T
  readonly currentSessionId: string | undefined
  readonly openSession: (sessionId: string) => void
  readonly onClose: () => void
}

function StarredTab({ t, currentSessionId, openSession, onClose }: StarredTabProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  const [searchQuery, setSearchQuery] = useState('')
  const addBtnRef = useRef<HTMLButtonElement>(null)

  return (
    // data-dsh-starred-boundary：拖出取消收藏的判定边界（原 .starred-tab-container）。
    <div className={css.starredRoot} data-dsh-starred-boundary>
      {/* 工具栏：新建文件夹 + 搜索（原 StarredTab.render） */}
      <div className={css.starredToolbar}>
        <button
          type="button"
          className={css.starredToolbarBtn}
          ref={addBtnRef}
          aria-label={t('starred.newFolder')}
          onMouseEnter={() => {
            if (addBtnRef.current !== null) {
              tooltip.show('add-folder-btn', addBtnRef.current, t('starred.newFolder'), { placement: 'top' })
            }
          }}
          onMouseLeave={() => { tooltip.hide() }}
          onClick={() => { void createFolderFlow(null, t) }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </button>
        <input
          type="text"
          className={css.starredToolbarSearch}
          placeholder={t('panel.searchPlaceholder')}
          autoComplete="off"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSearchQuery('')
          }}
        />
      </div>
      {/* 收藏树（共享组件，tab 场景带搜索） */}
      <div className={css.starredListTree}>
        <StarredTree
          currentSessionId={currentSessionId}
          openSession={openSession}
          onAfterNavigate={onClose}
          searchQuery={searchQuery.trim().toLowerCase()}
          searchEmptyClassName={css.starredEmpty}
          toastColors={STARRED_TAB_TOAST_COLOR}
          localExpansion
          t={t}
        />
      </div>
      {/* 底部：显示文件夹开关（DSH 单平台，开关直接内联，不再弹平台子弹窗） */}
      <div className={css.starredSidebarDivider} />
      <div className={css.starredSidebarToggle}>
        <SettingItem
          label={t('panel.starredDisplayLabel')}
          hint={t('panel.starredDisplayHint')}
          control={(
            <Toggle
              checked={settings.starredPanelEnabled}
              onChange={(enabled) => { settingsStore.set({ starredPanelEnabled: enabled }) }}
            />
          )}
        />
      </div>
    </div>
  )
}

// ==================== 提示词 tab ====================

function PromptTab({ t }: { readonly t: T }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  const prompts = useSyncExternalStore(promptsStore.subscribe, () => promptsStore.getAll())
  const sorted = useMemo(() => sortPrompts(prompts), [prompts])
  const [modal, setModal] = useState<{ readonly mode: 'add' } | { readonly mode: 'edit'; readonly prompt: Prompt } | null>(null)

  const actionTooltip = (id: string, text: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      tooltip.show(id, e.currentTarget, text, {})
    },
    onMouseLeave: () => { tooltip.hide() },
  })

  const deletePrompt = async (id: string): Promise<void> => {
    const confirmed = await popconfirm.show({
      title: t('panel.promptDeleteConfirm'),
      confirmText: t('starred.delete'),
      cancelText: t('common.cancel'),
      confirmTextType: 'danger',
    })
    if (confirmed) {
      promptsStore.remove(id)
      toast.success(t('panel.promptDeleted'))
    }
  }

  return (
    <div className={css.settingsRoot}>
      <div className={css.settingsScroll}>
        <div className={css.promptListSection}>
          <div className={css.promptListHeader}>
            <div className={css.promptListTitle}>{t('panel.promptListTitle')}</div>
            <button type="button" className={css.promptAddBtn} onClick={() => { setModal({ mode: 'add' }) }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{t('panel.promptAdd')}</span>
            </button>
          </div>
          <div className={css.promptListContainer}>
            {sorted.length === 0
              ? (
                <div className={css.promptEmpty}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <span>{t('panel.promptEmpty')}</span>
                </div>
              )
              : sorted.map(prompt => (
                <div key={prompt.id} className={css.promptItem}>
                  <div className={css.promptItemContent}>
                    <div className={css.promptItemHeader}>
                      <div className={css.promptItemName}>
                        {prompt.pinned === true
                          ? (
                            <span className={css.promptPinBadge}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                                <line x1="5" y1="3" x2="19" y2="3" />
                                <line x1="12" y1="7" x2="12" y2="21" />
                                <polyline points="8 11 12 7 16 11" />
                              </svg>
                            </span>
                          )
                          : null}
                        <span className={css.promptItemNameText}>{prompt.name}</span>
                      </div>
                      <div className={css.promptItemActions}>
                        <button
                          type="button"
                          className={prompt.pinned === true ? `${css.promptItemBtn} ${css.promptPinBtnActive}` : css.promptItemBtn}
                          {...actionTooltip('prompt-pin', t('panel.promptPin'))}
                          onClick={() => {
                            promptsStore.togglePin(prompt.id)
                            const nowPinned = prompt.pinned !== true
                            toast.success(nowPinned ? t('panel.promptPinned') : t('panel.promptUnpinned'))
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                            <line x1="5" y1="3" x2="19" y2="3" />
                            <line x1="12" y1="7" x2="12" y2="21" />
                            <polyline points="8 11 12 7 16 11" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={css.promptItemBtn}
                          {...actionTooltip('prompt-edit', t('starred.edit'))}
                          onClick={() => { setModal({ mode: 'edit', prompt }) }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={`${css.promptItemBtn} ${css.promptDeleteBtn}`}
                          {...actionTooltip('prompt-delete', t('starred.delete'))}
                          onClick={() => { void deletePrompt(prompt.id) }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={css.promptItemBtn}
                          {...actionTooltip('prompt-move-up', t('panel.promptMoveUp'))}
                          onClick={() => { promptsStore.move(prompt.id, 'up') }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <polyline points="18 15 12 9 6 15" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={css.promptItemBtn}
                          {...actionTooltip('prompt-move-down', t('panel.promptMoveDown'))}
                          onClick={() => { promptsStore.move(prompt.id, 'down') }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className={css.promptItemText}>
                      <span className={css.promptItemTextContent}>{prompt.content}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
      {/* 底部悬浮：显示提示词按钮（DSH 单平台，开关直接内联，不再弹平台子弹窗） */}
      <div className={css.bottomDivider} />
      <div className={css.bottomSection}>
        <SettingItem
          label={t('panel.promptBtnLabel')}
          hint={t('panel.promptBtnHint')}
          control={(
            <Toggle
              checked={settings.promptButtonEnabled}
              onChange={(enabled) => { settingsStore.set({ promptButtonEnabled: enabled }) }}
            />
          )}
        />
      </div>
      {modal !== null
        ? (
          <PromptModal
            t={t}
            prompt={modal.mode === 'edit' ? modal.prompt : null}
            onClose={() => { setModal(null) }}
          />
        )
        : null}
    </div>
  )
}

interface PromptModalProps {
  readonly t: T
  /** 编辑目标；null 为新增。 */
  readonly prompt: Prompt | null
  readonly onClose: () => void
}

/** 提示词编辑弹窗（原 showPromptModal；DSH 单平台，无「适用于」平台选择器）。 */
function PromptModal({ t, prompt, onClose }: PromptModalProps) {
  const isEdit = prompt !== null
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [name, setName] = useState(prompt?.name ?? '')
  const [content, setContent] = useState(prompt?.content ?? '')
  const nameRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const raf = requestAnimationFrame(() => { setVisible(true) })
    return () => { cancelAnimationFrame(raf) }
  }, [])

  // 内容区自动调高（原 autoResize，上限 200px）。
  const autoResize = (): void => {
    const el = contentRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${String(Math.min(el.scrollHeight, 200))}px`
  }
  useEffect(() => { autoResize() }, [])

  const close = (): void => {
    setClosing(true)
    setVisible(false)
    setTimeout(onClose, 200)
  }

  const save = (): void => {
    const trimmedName = name.trim()
    const trimmedContent = content.trim()
    if (trimmedName === '') {
      toast.error(t('panel.promptRequired'))
      nameRef.current?.focus()
      return
    }
    if (trimmedContent === '') {
      toast.error(t('panel.promptRequired'))
      contentRef.current?.focus()
      return
    }
    if (isEdit) {
      promptsStore.update(prompt.id, { name: trimmedName, content: trimmedContent })
      toast.success(t('panel.promptUpdated'))
    } else {
      promptsStore.add(trimmedName, trimmedContent)
      toast.success(t('panel.promptAdded'))
    }
    close()
  }

  return (
    <div className={visible && !closing ? `${css.promptModalOverlay} ${css.promptModalVisible}` : css.promptModalOverlay}>
      <div className={css.promptModal}>
        <div className={css.promptModalHeader}>
          <h3>{isEdit ? t('panel.promptEditTitle') : t('panel.promptAddTitle')}</h3>
          <button type="button" className={css.promptModalClose} onClick={close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={css.promptModalBody}>
          <div className={css.promptModalField}>
            <label>
              {t('panel.promptNameLabel')}
              <span className={css.requiredMark}>*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              className={css.promptModalInput}
              placeholder={t('panel.promptNamePlaceholder')}
              maxLength={16}
              value={name}
              onChange={(e) => { setName(e.target.value) }}
            />
          </div>
          <div className={css.promptModalField}>
            <label>
              {t('panel.promptContentLabel')}
              <span className={css.requiredMark}>*</span>
            </label>
            <textarea
              ref={contentRef}
              className={css.promptModalTextarea}
              placeholder={t('panel.promptContentPlaceholder')}
              rows={4}
              maxLength={20000}
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                autoResize()
              }}
            />
            <div className={css.promptCharCounter}>
              <span>{`${String(content.length)}/20000`}</span>
            </div>
          </div>
        </div>
        <div className={css.promptModalFooter}>
          <button type="button" className={`${css.promptModalBtn} ${css.promptModalCancel}`} onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className={`${css.promptModalBtn} ${css.promptModalConfirm}`} onClick={save}>
            {t('panel.promptSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== 输入框 tab ====================

/** 模式显示文字（原 _getModeLabel）。 */
function modeLabel(mode: SmartEnterMode, t: T): string {
  switch (mode) {
    case 'ctrlEnter': return `${CTRL_LABEL} + Enter`
    case 'shiftEnter': return 'Shift + Enter'
    default: return t('panel.smartEnterModeDouble')
  }
}

function SmartInputTab({ t }: { readonly t: T }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())

  // 提示文案中的 {mode} 替换为内联 Dropdown trigger（原 hintTemplate）。
  const hintTemplate = t('panel.smartEnterHint')
  const modeIndex = hintTemplate.indexOf('{mode}')
  const hintBefore = modeIndex >= 0 ? hintTemplate.slice(0, modeIndex) : hintTemplate
  const hintAfter = modeIndex >= 0 ? hintTemplate.slice(modeIndex + '{mode}'.length) : ''

  const setMode = (mode: SmartEnterMode): void => {
    // 切模式时重置换行提示次数（原 setMode：smartEnterToastCount: 0）。
    settingsStore.set({ smartEnterMode: mode, smartEnterToastCount: 0 })
  }

  return (
    <div className={css.smartInputRoot}>
      {/* 追问功能（原 tabs/smartInputBox 的 quickAskSection：setting-item 卡片行，
          标题/提示在卡内、开关同行，非平台列表） */}
      <div className={css.settingSection}>
        <SettingItem
          label={t('panel.quickAskTitle')}
          hint={t('panel.quickAskHint')}
          control={(
            <Toggle
              checked={settings.quickAskEnabled}
              onChange={(enabled) => { settingsStore.set({ quickAskEnabled: enabled }) }}
            />
          )}
        />
      </div>
      <div className={css.divider} />
      {/* 换行与发送消息：与追问功能同款 setting-item 卡片行（标题/提示在卡内、
          开关同行），提示文案中的 {mode} 仍替换为内联 Dropdown trigger。 */}
      <div className={css.settingSection}>
        <SettingItem
          label={t('panel.smartEnterTitle')}
          hint={(
            <>
              {hintBefore}
              {modeIndex >= 0
                ? (
                  <span
                    className={css.smartEnterModeTrigger}
                    onClick={(e) => {
                      dropdown.show({
                        trigger: e.currentTarget,
                        items: [
                          { label: modeLabel('doubleEnter', t), onClick: () => { setMode('doubleEnter') } },
                          { label: modeLabel('ctrlEnter', t), onClick: () => { setMode('ctrlEnter') } },
                          { label: modeLabel('shiftEnter', t), onClick: () => { setMode('shiftEnter') } },
                        ],
                        width: 180,
                        position: 'bottom-left',
                      })
                    }}
                  >
                    {modeLabel(settings.smartEnterMode, t)}
                    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                      <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )
                : null}
              {hintAfter}
            </>
          )}
          control={(
            <Toggle
              checked={settings.smartEnterEnabled}
              onChange={(enabled) => { settingsStore.set({ smartEnterEnabled: enabled }) }}
            />
          )}
        />
      </div>
    </div>
  )
}

// ==================== 公式复制 tab ====================

/** 公式复制 tab（原 FormulaTab：MathML 开关 + LaTeX 开关及复制格式）。 */
function FormulaTab({ t }: { readonly t: T }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  const currentFormat = settings.formulaFormat !== '' ? settings.formulaFormat : 'none'

  return (
    <div className={css.settingsRoot}>
      <div className={css.settingsScroll}>
        {/* 复制 MathML 公式（原 formula tab 区块间为 12px 空隙，无分割线） */}
        <div className={`${css.settingSection} ${css.formulaSectionGap}`}>
          <SettingItem
            label={t('formula.mathmlTitle')}
            hint={t('formula.mathmlHint')}
            control={(
              <Toggle
                checked={settings.formulaMathMLEnabled}
                onChange={(enabled) => { settingsStore.set({ formulaMathMLEnabled: enabled }) }}
              />
            )}
          />
        </div>
        {/* 复制 LaTeX 公式（开启时内联展示格式选择，原 format-section 显隐逻辑） */}
        <div className={css.settingSection}>
          <div className={css.settingItem}>
            <div className={css.settingInfo}>
              <div className={css.settingLabel}>{t('formula.latexTitle')}</div>
              <div className={css.settingHint}>{t('formula.latexHint')}</div>
              {settings.formulaLatexEnabled
                ? (
                  <div className={css.formatInline}>
                    <div className={css.formatInlineTitle}>{t('formula.formatTitle')}</div>
                    <div className={css.formatOptions}>
                      {FORMULA_FORMATS.map(format => (
                        <label key={format.id} className={css.formatOption}>
                          <input
                            type="radio"
                            name="dsh-tl-formula-format"
                            value={format.id}
                            checked={currentFormat === format.id}
                            onChange={() => { settingsStore.set({ formulaFormat: format.id }) }}
                          />
                          <span className={css.formatRadio} />
                          <span className={css.formatLabel}>
                            {format.id === 'none' ? t('formula.formatNone') : format.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
                : null}
            </div>
            <Toggle
              checked={settings.formulaLatexEnabled}
              onChange={(enabled) => { settingsStore.set({ formulaLatexEnabled: enabled }) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== 对话导出 tab ====================

function ExportTab({ t }: { readonly t: T }) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  // 与追问功能同款 setting-item 卡片行（标题/提示在卡内、开关同行），
  // 原「DeepSeek 平台行 + logo」随平台列表布局一并去除。
  return (
    <div className={css.exportRoot}>
      <div className={css.settingSection}>
        <SettingItem
          label={t('panel.exportTitle')}
          hint={t('panel.exportHint')}
          control={(
            <Toggle
              checked={settings.conversationExportEnabled}
              onChange={(enabled) => { settingsStore.set({ conversationExportEnabled: enabled }) }}
            />
          )}
        />
      </div>
    </div>
  )
}

// ==================== 数据同步 tab ====================

/** toast 主题配色（原 DataSyncTab.toastColors；两套都是黑底，统一取宿主 tooltip 底板 token）。 */
const SYNC_TOAST_COLOR = {
  light: { backgroundColor: 'var(--dsw-alias-tooltip-bg)', textColor: '#ffffff', borderColor: 'var(--dsw-alias-tooltip-bg)' },
  dark: { backgroundColor: 'var(--dsw-alias-tooltip-bg)', textColor: '#f5f5f5', borderColor: 'var(--dsw-alias-tooltip-bg)' },
}

/** 数据同步 tab（原 DataSyncTab，仅本地文件导入导出，云同步不迁移）。 */
function DataSyncTab({ t }: { readonly t: T }) {
  const [importMode, setImportMode] = useState<'merge' | 'overwrite'>('merge')
  const [status, setStatus] = useState<{ type: 'loading' | 'error'; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 导出数据（原 handleExport）。 */
  const handleExport = (): void => {
    try {
      setStatus({ type: 'loading', message: t('panel.syncExporting') })
      exportDataToFile()
      setStatus(null)
      toast.success(t('panel.syncExportSuccess'), null, { color: SYNC_TOAST_COLOR })
    } catch {
      setStatus(null)
      toast.error(t('panel.syncExportFailed'), null, { color: SYNC_TOAST_COLOR })
    }
  }

  /** 导入数据（原 handleImport）。 */
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (file === undefined) return

    // 重置 input，允许重复选择同一文件。
    e.target.value = ''

    try {
      setStatus({ type: 'loading', message: t('panel.syncImporting') })

      const text = await file.text()
      const importData: unknown = JSON.parse(text)

      // 验证数据格式（含来源指纹，避免误导入非本插件备份）。
      if (!isValidBackup(importData)) {
        throw new Error('Invalid data format')
      }

      if (importMode === 'overwrite') {
        overwriteData(importData.data as Record<string, unknown>)
      } else {
        mergeData(importData.data as Record<string, unknown>)
      }
      setStatus(null)

      // popConfirm 展示导入成功，提醒用户刷新（原 importSuccess 流程）。
      const confirmed = await popconfirm.show({
        title: t('panel.syncImportSuccess'),
        content: t('panel.syncImportSuccessHint'),
        confirmText: t('panel.syncRefreshPage'),
        cancelText: t('panel.syncRefreshLater'),
        confirmTextType: 'default',
      })
      if (confirmed) location.reload()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ type: 'error', message: `${t('panel.syncImportFailed')}: ${message}` })
    }
  }

  return (
    <div className={css.syncRoot}>
      <div className={css.syncSection}>
        <div className={css.syncHint}>{t('panel.syncHint')}</div>

        <div className={css.syncGroup}>
          <div className={css.syncItem}>
            <div className={css.syncItemLabel}>{t('panel.syncExportLabel')}</div>
            <div className={css.syncItemBody}>
              <button type="button" className={css.syncBtn} onClick={handleExport}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="12" y1="12" x2="12" y2="18" />
                  <polyline points="9,15 12,18 15,15" />
                </svg>
                {t('panel.syncExportBtn')}
              </button>
            </div>
          </div>
          <div className={css.syncItem}>
            <div className={css.syncItemLabel}>{t('panel.syncImportLabel')}</div>
            <div className={css.syncItemBody}>
              <div className={css.importOptions}>
                <label className={css.importOption}>
                  <input
                    type="radio"
                    name="dsh-tl-import-mode"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={() => { setImportMode('merge') }}
                  />
                  <span className={css.optionRadio} />
                  <span className={css.optionContent}>
                    <span className={css.optionLabel}>{t('panel.syncModeMerge')}</span>
                    <span className={css.optionDesc}>{t('panel.syncModeMergeDesc')}</span>
                  </span>
                </label>
                <label className={css.importOption}>
                  <input
                    type="radio"
                    name="dsh-tl-import-mode"
                    value="overwrite"
                    checked={importMode === 'overwrite'}
                    onChange={() => { setImportMode('overwrite') }}
                  />
                  <span className={css.optionRadio} />
                  <span className={css.optionContent}>
                    <span className={css.optionLabel}>{t('panel.syncModeOverwrite')}</span>
                    <span className={css.optionDesc}>{t('panel.syncModeOverwriteDesc')}</span>
                  </span>
                </label>
              </div>
              <button
                type="button"
                className={css.syncBtn}
                onClick={() => { fileInputRef.current?.click() }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <polyline points="9,15 12,12 15,15" />
                </svg>
                {t('panel.syncImportBtn')}
              </button>
            </div>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => { void handleImport(e) }}
        />
      </div>

      {status !== null
        ? (
          <div
            className={`${css.syncStatus} ${status.type === 'loading' ? css.syncStatusLoading : css.syncStatusError}`}
          >
            {status.message}
          </div>
        )
        : null}
    </div>
  )
}
