/**
 * 版本更新弹窗 + 更新 Logo 按钮（移植原 global/changelog-modal +
 * prompt-button-manager 的 Logo 按钮）。
 * - changelogModal.show()：命令式打开弹窗（Logo 按钮点击 / popup 模式自动弹）。
 * - ChangelogHost：挂在 UiHost 下的渲染宿主，关闭时标记已读。
 * - UpdateLogoButton：icon 模式下随提示词按钮出现的 Logo + 小红点。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { tooltip } from '../ui/tooltip.tsx'
import { Bus } from '../ui/bus.ts'
import { CHANGELOG_DATA, changelogReadStore, type ChangelogItem } from './data.ts'
import { LOGO_DATA_URL } from './logo.ts'
import css from './changelog.module.css'

type T = TranslateNS<typeof NS>

/** 插件版本（原 chrome.runtime.getManifest().version）。 */
const VERSION = '0.1.0'
/** 展示的用户量（原 userCount 常量）。 */
const USER_COUNT = '37,000+'
const DOCS_URL = 'https://timeline4ai.com/#/guide?section=timeline'
const GITHUB_URL = 'https://github.com/houyanchao/dsh-timeline'

const openBus = new Bus<boolean>(false)

/** 命令式 API（原 window.changelogModal）。 */
export const changelogModal = {
  show(): void {
    const hasContent = CHANGELOG_DATA.features.length > 0 || CHANGELOG_DATA.improvements.length > 0
    if (CHANGELOG_DATA.id === '' || !hasContent) return
    openBus.set(true)
  },
}

/** 当前语言（原 _getLang 跟随界面语言；DSH 下优先宿主 html[lang]，回退浏览器语言）。 */
function getLang(): 'zh' | 'en' {
  const hostLang = document.documentElement.lang
  const uiLang = hostLang !== '' ? hostLang : (navigator.language !== '' ? navigator.language : 'en')
  return uiLang.startsWith('zh') ? 'zh' : 'en'
}

/** 分组区域（原 _renderSection）。 */
function Section({ title, emoji, items, lang }: {
  readonly title: string
  readonly emoji: string
  readonly items: readonly ChangelogItem[]
  readonly lang: 'zh' | 'en'
}) {
  if (items.length === 0) return null
  return (
    <div className={css.section}>
      <div className={css.sectionHeader}>
        <span className={css.sectionEmoji}>{emoji}</span>
        <span className={css.sectionTitle}>{title}</span>
      </div>
      <ul className={css.list}>
        {items.map((item, index) => (
          <li key={index} className={css.item}>
            <span className={css.itemDot} />
            <span className={css.itemText}>{item[lang]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 弹窗宿主（挂在 UiHost 下）。
 * @param props - 词典。
 * @returns 打开时渲染弹窗，否则 null。
 */
export function ChangelogHost({ t }: { readonly t: T }) {
  const open = useSyncExternalStore(openBus.subscribe, () => openBus.get())
  const [visible, setVisible] = useState(false)
  // 深浅主题实时跟随（原版走 html[data-timeline-theme] CSS 选择器，切主题即时生效）。
  const [dark, setDark] = useState(() => detectDarkTheme())
  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])
  const lang = getLang()

  // popup 模式：加载 3 秒后有未读更新则自动弹窗（原全局单例分支）。
  useEffect(() => {
    if (CHANGELOG_DATA.displayMode !== 'popup') return
    const timer = setTimeout(() => {
      if (changelogReadStore.hasUpdate()) changelogModal.show()
    }, 3000)
    return () => { clearTimeout(timer) }
  }, [])

  // 打开后下一帧加 visible 触发入场过渡（原 requestAnimationFrame）。
  useEffect(() => {
    if (!open) { setVisible(false); return }
    const raf = requestAnimationFrame(() => { setVisible(true) })
    return () => { cancelAnimationFrame(raf) }
  }, [open])

  // ESC 关闭（原 _handleEscape）。
  useEffect(() => {
    if (!open) return
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeydown)
    return () => { document.removeEventListener('keydown', onKeydown) }
  }, [open])

  if (!open) return null

  /** 关闭并标记已读（原 _close：退场过渡 200ms 后移除）。 */
  function close(): void {
    setVisible(false)
    changelogReadStore.markAsRead()
    setTimeout(() => { openBus.set(false) }, 200)
  }

  return (
    <div className={css.root} data-theme={dark ? 'dark' : 'light'}>
      <div
        className={visible ? `${css.overlay} ${css.visible}` : css.overlay}
        onClick={(e) => { if (e.target === e.currentTarget) close() }}
      >
        <div className={css.modal}>
          <div className={css.header}>
            <div className={css.icon}>
              <img className={css.logo} src={LOGO_DATA_URL} alt="logo" />
            </div>
            <div className={css.headerContent}>
              <div className={css.title}>
                {t('changelog.title')}
                <span className={css.versionBadge}>{`v${VERSION}`}</span>
              </div>
              <div className={css.subtitle}>
                {t('changelog.subtitle').replace('{count}', USER_COUNT)}
              </div>
            </div>
          </div>
          <div className={css.body}>
            <Section title={t('changelog.features')} emoji="✨" items={CHANGELOG_DATA.features} lang={lang} />
            <Section title={t('changelog.improvements')} emoji="🔧" items={CHANGELOG_DATA.improvements} lang={lang} />
          </div>
          <div className={css.ratingBar}>
            <span className={css.ratingText}>{t('changelog.ratingText')}</span>
            <a className={css.ratingBtn} href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              {t('changelog.ratingBtn')}
            </a>
          </div>
          <div className={css.footer}>
            <div className={css.footerLinks}>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={css.footerIcon}
                onMouseEnter={(e) => {
                  tooltip.showOverlay(e.currentTarget, t('changelog.docs'), { placement: 'top' })
                }}
                onMouseLeave={() => { tooltip.hide() }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden>
                  <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                </svg>
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={css.footerIcon}
                onMouseEnter={(e) => {
                  tooltip.showOverlay(e.currentTarget, t('changelog.github'), { placement: 'top' })
                }}
                onMouseLeave={() => { tooltip.hide() }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden>
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
                </svg>
              </a>
            </div>
            <button type="button" className={css.confirmBtn} onClick={close}>
              {t('changelog.gotIt')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 更新 Logo 按钮（原 _createUpdateButton：icon 模式且有未读更新时显示）。
 * 原版还要求 chatTimes 有使用记录才展示；DSH 无 chatTimes 存储
 * （节点时间来自宿主快照），该门控经确认有意去除。
 * 配色走宿主 token（自带深浅两套值），故不需要主题入参。
 * @param props - 词典。
 * @returns Logo 按钮或 null。
 */
export function UpdateLogoButton({ t }: { readonly t: T }) {
  useSyncExternalStore(changelogReadStore.subscribe, () => changelogReadStore.hasUpdate())
  if (CHANGELOG_DATA.displayMode !== 'icon' || !changelogReadStore.hasUpdate()) return null

  return (
    <button
      type="button"
      className={css.updateBtn}
      aria-label={t('changelog.updateBtn')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        changelogModal.show()
      }}
    >
      <img className={css.updateLogo} src={LOGO_DATA_URL} alt="logo" />
      <span className={css.updateDot} />
    </button>
  )
}
