/**
 * 提示词按钮 + 下拉面板：移植原 PromptButtonManager + prompt-dropdown-ui。
 * 按钮浮在 composer 卡片左外侧、与卡片顶部对齐（原 _updatePosition 的 fixed 定位），
 * 挂 conversation.input.left 槽位只为借会话页生命周期与输入框 store，本体 portal 到 body。
 * 点击弹出固定尺寸（320x400）向上展开的下拉：提示词 Tab（搜索/列表/空态）
 * + 常用设置 Tab（反馈、GitHub Star、AI 完成提醒、阻止跳底开关、换行发送设置）。
 * 点提示词把内容追加进输入框草稿（原 _defaultInsertText 的 textarea 分支）。
 * 同组件挂载智能回车（useSmartEnter）与发送后防跳底（usePreventAutoScroll）。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { settingsStore } from '../shared/settings.ts'
import { usePreventAutoScroll } from '../shared/preventAutoScroll.ts'
import { tooltip } from '../ui/tooltip.tsx'
import { panelModal } from '../panelModal/bus.ts'
import { UpdateLogoButton } from '../changelog/ChangelogModal.tsx'
import { promptsStore, sortPrompts, type Prompt } from './storage.ts'
import { useSmartEnter } from './smartEnter.ts'
import css from './smartInput.module.css'

/** 下拉固定尺寸与定位参数（原 _positionPromptDropdown）。 */
const DROPDOWN_WIDTH = 320
const DROPDOWN_HEIGHT = 400
const TOP_PADDING = 20
const GAP = 8

/** GitHub 仓库（原插件商店链接在 DSH 下统一指向 GitHub）。 */
const GITHUB_URL = 'https://github.com/houyanchao/chatgpt-gemini-timeline'
const FEEDBACK_URL = 'https://github.com/houyanchao/chatgpt-gemini-timeline/issues'

/** composer 的 textarea（草稿插入后聚焦/滚动用）。 */
const INPUT_SELECTOR = '[data-input-scroll] textarea'

/** 定位参考元素：composer 卡片（对位原 DeepSeek 适配器的 .ds-scroll-area__gutters）。 */
const CARD_SELECTOR = '[data-composer-card]'
/** 卡片所在的 sticky 座位：状态条/统计行/队列 dock 等兄弟节点会挤动卡片，
    这些变化不改卡片自身尺寸，只有观察这一层才能跟上（顺带覆盖侧栏折叠动画）。 */
const SEAT_SELECTOR = '[data-composer-seat]'
/** 按钮与卡片的间距（原 config.gap）。 */
const CARD_GAP = 8
/** 相对卡片左上角的微调（原 DeepSeek 适配器 getPromptButtonOffset）。 */
const CARD_OFFSET_TOP = 10
const CARD_OFFSET_LEFT = -2
/** 视口边缘留白（原 _updatePosition 的边界检查）。 */
const VIEWPORT_EDGE = 8

function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 追加文本的最终草稿（原 _defaultInsertText 的 textarea 分支）。 */
function appendPromptText(existingText: string, text: string): string {
  if (existingText.trim() === '') return `${text}\n\n`
  const cleanedText = existingText.replace(/\n+$/, '')
  return `${cleanedText}\n\n${text}\n\n`
}

/** 浮动容器的视口坐标。 */
interface FloatPos {
  readonly top: number
  readonly left: number
}

/**
 * 跟随 composer 卡片的浮动定位（原 PromptButtonManager._updatePosition）。
 * 容器右端贴在卡片左外侧，故 Logo 按钮出现/消失时提示词按钮本身不移位。
 * @param rowRef - 浮动容器，用于取自身尺寸做右端对齐与边界修正。
 * @param enabled - 按钮是否启用（关闭时容器不渲染，需重建观察）。
 * @returns 视口坐标；卡片不可见时为 null（对应原 _hideButton）。
 */
function useComposerAnchor(rowRef: RefObject<HTMLDivElement | null>, enabled: boolean): FloatPos | null {
  const [pos, setPos] = useState<FloatPos | null>(null)

  useLayoutEffect(() => {
    if (!enabled) return

    let card: HTMLElement | null = null
    let seat: Element | null = null
    let raf = 0
    const observer = new ResizeObserver(() => { schedule() })

    // 卡片随草稿换行长高、会话切换时也可能被换节点，故解析结果需可重绑。
    function bindCard(): void {
      const next = document.querySelector<HTMLElement>(CARD_SELECTOR)
      if (next === card) return
      if (card !== null) observer.unobserve(card)
      if (seat !== null) observer.unobserve(seat)
      card = next
      seat = next?.closest(SEAT_SELECTOR) ?? null
      if (card !== null) observer.observe(card)
      if (seat !== null) observer.observe(seat)
    }

    function measure(): void {
      if (card === null || !card.isConnected) bindCard()
      if (card === null) { setPos(null); return }

      const rect = card.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) { setPos(null); return }

      const row = rowRef.current
      const width = row?.offsetWidth ?? 0
      const height = row?.offsetHeight ?? 0

      const top = Math.max(
        VIEWPORT_EDGE,
        Math.min(rect.top + CARD_OFFSET_TOP, window.innerHeight - height - VIEWPORT_EDGE),
      )
      // 卡片左侧空间不足（窄视口下侧边留白仅 16px）时贴住视口左缘。
      const left = Math.max(VIEWPORT_EDGE, rect.left + CARD_OFFSET_LEFT - CARD_GAP - width)
      setPos(prev => prev !== null && prev.top === top && prev.left === left ? prev : { top, left })
    }

    function schedule(): void {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }

    // 容器自身尺寸也要观察：Logo 按钮出现时容器变宽，右端对齐需重算。
    const row = rowRef.current
    if (row !== null) observer.observe(row)
    bindCard()
    measure()

    window.addEventListener('resize', schedule)
    // 侧栏折叠等动画结束后卡片才落到终点位置（原 _transitionHandler）。
    document.body.addEventListener('transitionend', schedule)

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.body.removeEventListener('transitionend', schedule)
    }
    // rowRef 是稳定引用，不入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return pos
}

/** 完整 props：输入工具行槽位运行时 + 词典。 */
export type PromptButtonProps = PropsRuntime<'conversation.input.left'> & PropsLocale<typeof NS>

/**
 * 提示词按钮（含下拉与智能回车挂载）。
 * @param props - 槽位运行时 + 词典。
 * @returns 提示词按钮；设置关闭时不渲染。
 */
export function PromptButton({ useInput, useSession, inputActions, t }: PromptButtonProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  const prompts = useSyncExternalStore(promptsStore.subscribe, () => promptsStore.getAll())
  const draft = useInput(s => s.draft)
  const inputPhase = useInput(s => s.phase)
  const running = useSession(s => s.running)

  // 发送后防跳底（原 preventAutoScroll 模块，随 composer 存在期挂载）。
  usePreventAutoScroll(running, inputPhase, draft)

  const [dark, setDark] = useState(() => detectDarkTheme())
  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const pos = useComposerAnchor(rowRef, settings.promptButtonEnabled)

  // 智能回车：随本组件（composer 存在期）挂载。
  useSmartEnter((mode) => {
    if (mode === 'ctrlEnter') {
      const ctrlLabel = navigator.platform.toUpperCase().includes('MAC') ? '⌘' : 'Ctrl'
      return t('smartEnter.toastCtrl').replace('{ctrl}', ctrlLabel)
    }
    if (mode === 'shiftEnter') return t('smartEnter.toastShift')
    return t('smartEnter.toastDouble')
  })

  /** 插入提示词（原 _insertPrompt → _defaultInsertText）。 */
  const insertPrompt = (prompt: Prompt): void => {
    if (prompt.content === '') return
    const finalText = appendPromptText(draftRef.current, prompt.content)
    inputActions.setDraft(finalText)
    // 延迟聚焦、光标到末尾并滚到底（原 setTimeout(50)）。
    setTimeout(() => {
      const input = document.querySelector<HTMLTextAreaElement>(INPUT_SELECTOR)
      if (input === null) return
      input.focus()
      input.selectionStart = input.value.length
      input.selectionEnd = input.value.length
      const scroll = input.closest('[data-input-scroll]')
      if (scroll !== null) scroll.scrollTop = scroll.scrollHeight
    }, 50)
  }

  if (!settings.promptButtonEnabled) return null

  return (
    <>
      {createPortal(
        // 未量到卡片前先隐藏，避免按钮在 (0,0) 闪一帧（原先量尺寸时的 visibility 处理）。
        <div
          ref={rowRef}
          className={css.floatingRow}
          style={pos === null ? { visibility: 'hidden' } : { top: `${pos.top}px`, left: `${pos.left}px` }}
        >
          {/* 版本更新 Logo（原提示词按钮左侧的 smart-input-update-btn，有未读更新时显示） */}
          <UpdateLogoButton t={t} dark={dark} />
          <button
            ref={btnRef}
            type="button"
            className={css.promptBtn}
            data-theme={dark ? 'dark' : 'light'}
            aria-label={t('prompt.title')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setOpen(v => !v)
            }}
          >
            <svg className={css.promptIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </button>
        </div>,
        document.body,
      )}
      {open
        ? (
          <PromptDropdown
            anchor={btnRef.current}
            dark={dark}
            prompts={prompts}
            preventAutoScrollEnabled={settings.preventAutoScrollEnabled}
            t={t}
            onClose={() => { setOpen(false) }}
            onItemClick={(p) => {
              setOpen(false)
              insertPrompt(p)
            }}
          />
        )
        : null}
    </>
  )
}

interface PromptDropdownProps {
  readonly anchor: HTMLElement | null
  readonly dark: boolean
  readonly prompts: readonly Prompt[]
  readonly preventAutoScrollEnabled: boolean
  readonly t: PromptButtonProps['t']
  readonly onClose: () => void
  readonly onItemClick: (prompt: Prompt) => void
}

/** 提示词下拉面板（原 createPromptDropdownUI，portal 到 body）。 */
function PromptDropdown({ anchor, dark, prompts, preventAutoScrollEnabled, t, onClose, onItemClick }: PromptDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [activeTab, setActiveTab] = useState<'prompts' | 'common-settings'>('prompts')
  const [query, setQuery] = useState('')

  // 定位（原 _positionPromptDropdown：与按钮左对齐、向上展开、边界修正）。
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null || anchor === null) return
    const buttonRect = anchor.getBoundingClientRect()

    let left = buttonRect.left
    if (left + DROPDOWN_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - DROPDOWN_WIDTH - 8
    }
    left = Math.max(8, left)
    const top = Math.max(TOP_PADDING, buttonRect.top - GAP - DROPDOWN_HEIGHT)

    el.style.width = `${DROPDOWN_WIDTH}px`
    el.style.height = `${DROPDOWN_HEIGHT}px`
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [anchor])

  // 入场动画（原 requestAnimationFrame 加 visible 类）。
  useEffect(() => {
    const raf = requestAnimationFrame(() => { setVisible(true) })
    return () => { cancelAnimationFrame(raf) }
  }, [])

  // 点击外部关闭（原 _boundCloseOnClickOutside，capture）。
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) !== true && target !== anchor && anchor?.contains(target) !== true) {
        tooltip.hide(true)
        onClose()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', onClick, true)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', onClick, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sorted = sortPrompts(prompts)
  const q = query.trim().toLowerCase()
  const filtered = q === ''
    ? sorted
    : sorted.filter(p => p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))

  const openManage = (): void => {
    tooltip.hide(true)
    onClose()
    panelModal.show('prompt')
  }

  return createPortal(
    <>
      <div className={css.overlay} onClick={onClose} />
      <div
        ref={containerRef}
        className={visible ? `${css.container} ${css.visible}` : css.container}
        data-theme={dark ? 'dark' : 'light'}
      >
        {/* ===== 顶部 Tab（原 prompt-dropdown-tabs） ===== */}
        <div className={css.tabs}>
          <div className={css.tabGroup}>
            <button
              type="button"
              className={activeTab === 'prompts' ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => { setActiveTab('prompts') }}
            >
              <span className={css.tabText}>{t('prompt.title')}</span>
              <span
                className={css.tabIcon}
                aria-label={t('prompt.add')}
                onClick={(e) => {
                  e.stopPropagation()
                  openManage()
                }}
                onMouseEnter={(e) => {
                  tooltip.showOverlay(e.currentTarget, t('prompt.add'), { placement: 'top', theme: dark ? 'dark' : 'light' })
                }}
                onMouseLeave={() => { tooltip.hideOverlay() }}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              className={activeTab === 'common-settings' ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => { setActiveTab('common-settings') }}
            >
              <span className={css.tabText}>{t('prompt.commonSettingsTab')}</span>
              <span
                className={css.tabIcon}
                aria-label={t('prompt.allSettings')}
                onClick={(e) => {
                  e.stopPropagation()
                  tooltip.hide(true)
                  onClose()
                  panelModal.show('timeline')
                }}
                onMouseEnter={(e) => {
                  tooltip.showOverlay(e.currentTarget, t('prompt.allSettings'), { placement: 'top', theme: dark ? 'dark' : 'light' })
                }}
                onMouseLeave={() => { tooltip.hideOverlay() }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.91 2.34 2.34 0 0 1 2.33 4.04 2.34 2.34 0 0 0 0 3.82 2.34 2.34 0 0 1-2.33 4.04 2.34 2.34 0 0 0-3.32 1.91 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.91 2.34 2.34 0 0 1-2.33-4.04 2.34 2.34 0 0 0 0-3.82 2.34 2.34 0 0 1 2.33-4.04 2.34 2.34 0 0 0 3.32-1.91Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
            </button>
          </div>
          <button
            type="button"
            className={css.shareBtn}
            aria-label={t('prompt.share')}
            onClick={(e) => {
              e.stopPropagation()
              openExternalUrl(GITHUB_URL)
            }}
            onMouseEnter={(e) => {
              tooltip.showOverlay(e.currentTarget, t('prompt.share'), { placement: 'top', theme: dark ? 'dark' : 'light' })
            }}
            onMouseLeave={() => { tooltip.hideOverlay() }}
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

        {/* ===== 提示词面板 ===== */}
        <div className={activeTab === 'prompts' ? `${css.panel} ${css.panelActive}` : css.panel}>
          {sorted.length >= 5
            ? (
              <div className={css.search}>
                <input
                  type="text"
                  className={css.searchInput}
                  placeholder={t('prompt.search')}
                  autoComplete="off"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value) }}
                />
              </div>
            )
            : null}
          <div className={css.body}>
            {sorted.length === 0
              ? (
                <div className={css.empty}>
                  <span className={css.emptyHint}>{t('prompt.emptyHint')}</span>
                  <button
                    type="button"
                    className={css.emptyAction}
                    onClick={(e) => {
                      e.stopPropagation()
                      openManage()
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                      <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span>{t('prompt.add')}</span>
                  </button>
                </div>
              )
              : filtered.length === 0
                ? <div className={css.searchEmpty}>{t('prompt.noResults')}</div>
                : filtered.map(prompt => (
                  <PromptItem key={prompt.id} prompt={prompt} onClick={() => { onItemClick(prompt) }} />
                ))}
          </div>
        </div>

        {/* ===== 常用设置面板（原 _promptDropdownCreateCommonSettings） ===== */}
        <div className={activeTab === 'common-settings' ? `${css.panel} ${css.panelActive}` : css.panel}>
          <div className={css.commonSettings}>
            <div className={css.settingItem}>
              <div className={css.settingInfo}>
                <div className={css.settingTitleRow}>
                  <div className={css.settingLabel}>{t('prompt.feedbackTitle')}</div>
                </div>
                <div className={css.settingHint}>{t('prompt.feedbackHint')}</div>
              </div>
              <button
                type="button"
                className={css.settingBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  openExternalUrl(FEEDBACK_URL)
                }}
              >
                {t('prompt.feedbackButton')}
              </button>
            </div>
            <div className={css.settingItem}>
              <div className={css.settingInfo}>
                <div className={css.settingTitleRow}>
                  <div className={css.settingLabel}>{t('prompt.githubStarTitle')}</div>
                </div>
                <div className={css.settingHint}>{t('prompt.githubStarHint')}</div>
              </div>
              <button
                type="button"
                className={css.settingBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  openExternalUrl(GITHUB_URL)
                }}
              >
                {t('prompt.githubStarButton')}
              </button>
            </div>
            <div className={css.settingItem}>
              <div className={css.settingInfo}>
                <div className={css.settingTitleRow}>
                  <div className={css.settingLabel}>{t('prompt.aiCompleteTitle')}</div>
                </div>
                <div className={css.settingHint}>{t('prompt.aiCompleteHint')}</div>
              </div>
              <button
                type="button"
                className={css.settingBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  tooltip.hide(true)
                  onClose()
                  // 深链直开提醒子弹窗（原 TimelineSettingsTab.showAICompleteReminderModal）。
                  panelModal.show('timeline', 'aiCompleteReminder')
                }}
              >
                {t('prompt.settings')}
              </button>
            </div>
            <div className={css.settingItem}>
              <div className={css.settingInfo}>
                <div className={css.settingTitleRow}>
                  <div className={css.settingLabel}>{t('prompt.preventAutoScrollLabel')}</div>
                </div>
                <div className={css.settingHint}>{t('prompt.preventAutoScrollHint')}</div>
              </div>
              <label className={css.toggleSwitch}>
                <input
                  type="checkbox"
                  checked={preventAutoScrollEnabled}
                  onChange={(e) => {
                    settingsStore.set({ preventAutoScrollEnabled: e.target.checked })
                  }}
                />
                <span className={css.toggleSlider} />
              </label>
            </div>
            <div className={css.settingItem}>
              <div className={css.settingInfo}>
                <div className={css.settingTitleRow}>
                  <div className={css.settingLabel}>{t('prompt.smartInputTitle')}</div>
                </div>
                <div className={css.settingHint}>{t('prompt.smartInputHint')}</div>
              </div>
              <button
                type="button"
                className={css.settingBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  tooltip.hide(true)
                  onClose()
                  panelModal.show('smartInputBox')
                }}
              >
                {t('prompt.settings')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

interface PromptItemProps {
  readonly prompt: Prompt
  readonly onClick: () => void
}

/** 单条提示词（原 _promptDropdownCreateItem：置顶图标 + 溢出时 hover tooltip）。 */
function PromptItem({ prompt, onClick }: PromptItemProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <div
      className={css.item}
      onClick={onClick}
      onMouseEnter={(e) => {
        const contentEl = contentRef.current
        if (prompt.content === '' || contentEl === null) return
        if (contentEl.scrollWidth <= contentEl.clientWidth) return
        tooltip.show(`prompt-dd-${prompt.id}`, e.currentTarget, prompt.content, {
          placement: 'right',
          maxWidth: 300,
          showDelay: 300,
          gap: 14,
        })
      }}
      onMouseLeave={() => { tooltip.hide() }}
    >
      <div className={css.itemMain}>
        {prompt.pinned === true
          ? (
            <span className={`${css.itemIcon} ${css.pinnedIcon}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2.5" aria-hidden>
                <line x1="5" y1="3" x2="19" y2="3" />
                <line x1="12" y1="7" x2="12" y2="21" />
                <polyline points="8 11 12 7 16 11" />
              </svg>
            </span>
          )
          : null}
        <span className={css.itemName}>{prompt.name}</span>
      </div>
      <div ref={contentRef} className={css.itemContent}>{prompt.content}</div>
    </div>
  )
}
