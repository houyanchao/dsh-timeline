/**
 * 提示词按钮 + 下拉面板：移植原 PromptButtonManager + prompt-dropdown-ui。
 * 按钮坐在 DSH composer 工具行、紧挨宿主「命令」按钮右侧：
 * conversation.input.left 槽位只渲染在常驻控件之后，宿主没有命令与权限
 * 之间的槽位，故挂槽位借生命周期，本体 portal 到手动插在命令按钮后的容器
 * （useCommandSideSeat）。
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
const GITHUB_URL = 'https://github.com/houyanchao/dsh-timeline'
const FEEDBACK_URL = 'https://github.com/houyanchao/dsh-timeline/issues'

/** composer 的 textarea（草稿插入后聚焦/滚动用）。 */
const INPUT_SELECTOR = '[data-input-scroll] textarea'

function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 追加文本的最终草稿（原 _defaultInsertText 的 textarea 分支）。 */
function appendPromptText(existingText: string, text: string): string {
  if (existingText.trim() === '') return `${text}\n\n`
  const cleanedText = existingText.replace(/\n+$/, '')
  return `${cleanedText}\n\n${text}\n\n`
}

/** 宿主「命令」按钮（工具行里唯一的 listbox 弹出按钮，InputBar 的 .add）。 */
const COMMAND_BTN_SELECTOR = 'button[aria-haspopup="listbox"]'

/**
 * 提示词库 tooltip 配色：单套固定形态，直接引宿主原生 tooltip 的 token
 * （ui-primitives Tooltip 的深色底板 + 恒白文字；边框取底色即隐形）。
 */
const LIBRARY_TIP_COLOR = {
  backgroundColor: 'var(--dsw-alias-tooltip-bg)',
  textColor: 'var(--dsw-static-neutral-bluish-00)',
  borderColor: 'var(--dsw-alias-tooltip-bg)',
} as const

/**
 * 在【命令】按钮紧邻右侧造一个 portal 挂载座。
 * 容器 display: contents，两个按钮直接成为工具行的 flex 项、
 * 吃行自己的 16px 间距；行卸载（会话切换）时本组件同月同灭，
 * 清理函数移除容器即可。
 * @param markerRef - 渲染在槽位里的隐藏锚点，向上定位工具行。
 * @param enabled - 按钮是否启用（关闭时锚点不渲染，需重建）。
 * @returns 挂载座；定位不到命令按钮时为 null（调用方就地渲染兜底）。
 */
function useCommandSideSeat(markerRef: RefObject<HTMLElement | null>, enabled: boolean): HTMLElement | null {
  const [seat, setSeat] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!enabled) return
    const marker = markerRef.current
    if (marker === null) return

    // 槽位条目外面有宿主的包装节点，从锚点向上找到包含命令按钮的工具行。
    let tools: HTMLElement | null = marker.parentElement
    while (tools !== null && tools.querySelector(COMMAND_BTN_SELECTOR) === null) {
      tools = tools.parentElement
    }
    const commandBtn = tools?.querySelector(COMMAND_BTN_SELECTOR) ?? null
    if (tools === null || commandBtn === null) return

    // 命令按钮理论上可能被再包一层，锚定到工具行的直接子节点。
    let anchorTop: Element = commandBtn
    while (anchorTop.parentElement !== null && anchorTop.parentElement !== tools) {
      anchorTop = anchorTop.parentElement
    }

    const container = document.createElement('div')
    container.style.display = 'contents'
    tools.insertBefore(container, anchorTop.nextSibling)
    setSeat(container)
    return () => {
      container.remove()
      setSeat(null)
    }
    // markerRef 是稳定引用，不入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return seat
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
  const markerRef = useRef<HTMLSpanElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const seat = useCommandSideSeat(markerRef, settings.promptButtonEnabled)

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

  const buttons = (
    <>
      {/* 版本更新 Logo（原提示词按钮左侧的 smart-input-update-btn，有未读更新时显示） */}
      <UpdateLogoButton t={t} />
      <button
        ref={btnRef}
        type="button"
        className={css.promptBtn}
        aria-label={t('prompt.tooltipLibrary')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          tooltip.hide(true)
          setOpen(v => !v)
        }}
        onMouseEnter={(e) => {
          tooltip.show('prompt-btn-library', e.currentTarget, t('prompt.tooltipLibrary'), {
            placement: 'top',
            showDelay: 300,
            noArrow: true,
            size: 'small',
            color: LIBRARY_TIP_COLOR,
          })
        }}
        onMouseLeave={() => { tooltip.hide() }}
      >
        <svg className={css.promptIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </button>
    </>
  )

  return (
    <>
      {/* 隐藏锚点：只用来定位工具行（本体 portal 到命令按钮右侧的挂载座）。 */}
      <span ref={markerRef} hidden />
      {seat !== null ? createPortal(buttons, seat) : buttons}
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
    // 「+」图标 hover 中的「添加提示词」mini tooltip（showOverlay）靠 mouseleave
    // 关闭，而点击后下拉整体卸载、mouseleave 不再触发，须在此强清两条总线。
    tooltip.forceHideAll()
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
                  // 同 openManage：「全部设置」mini tooltip 随下拉卸载后无 mouseleave 兜底，须强清。
                  tooltip.forceHideAll()
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
