/**
 * 追问浮动按钮（移植原 quickAsk/index.js 门控 + quick-ask-manager.js）。
 *
 * 选中会话正文文字后浮出「追问」按钮，点击把选中文字按 Markdown 引用格式
 * （每行 `> ` 前缀）追加进输入框草稿，随后聚焦输入框、光标移到末尾。
 *
 * 与原版的架构性适配：
 * - 门控：原「平台 features.quickAsk + isConversationRoute + URL 变化监听」
 *   在 DSH 折叠为槽位挂载（composer 存在期）+ settingsStore 开关 + 会话快照
 *   blank 位（空白会话无正文可选，不挂选区监听）；选区包含性校验以聊天
 *   消息流 [data-chat-flow] 为界（找不到该容器时放行任意选区兜底），
 *   不再兼任路由探测；
 * - 插入：原 _insertToInput 的 contenteditable / Slate 分支为多平台服务，
 *   DSH composer 是受控 textarea，走 inputActions.setDraft（textarea 分支等价物）；
 * - 事件委托（原 eventDelegateManager，解决长时间停留后监听失效）由 React
 *   组件生命周期天然覆盖；
 * - 复制按钮（原 _syncCopyButton + selection-copy.js）：选区含公式且公式复制
 *   开关开启时显示，见 selectionCopy.ts；
 * - 标注按钮（原 _syncHighlightButton）依赖 highlight 模块，已确定不迁移，剔除。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { settingsStore } from '../shared/settings.ts'
import { toast } from '../ui/toast.tsx'
import uiCss from '../ui/ui.module.css'
import { copyRange, hasRichContent } from './selectionCopy.ts'
import css from './quickAsk.module.css'

/** 浮动按钮位置类型（原 _calculatePosition 的六方位）。 */
type Position = 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight'

/** 位置回退映射：当首选位置空间不够时，切换到对应的备选位置。 */
const POSITION_FALLBACK: Record<Position, Position> = {
  topCenter: 'bottomCenter',
  topLeft: 'bottomLeft',
  topRight: 'bottomRight',
  bottomCenter: 'topCenter',
  bottomLeft: 'topLeft',
  bottomRight: 'topRight',
}

/** 默认位置（原 this._position = 'topLeft'）。 */
const DEFAULT_POSITION: Position = 'topLeft'
/** 按钮与选区的间距（原 gap = 8）。 */
const GAP = 8
/** 距离屏幕边缘的最小间距（原 margin = 10）。 */
const MARGIN = 10
/** 测量兜底的按钮最小宽高（原 Math.max(width, 80) / Math.max(height, 28)）。 */
const MIN_WIDTH = 80
const MIN_HEIGHT = 28
/** mouseup 后延迟检查选区，确保选区已更新（原 setTimeout 10ms）。 */
const CHECK_DELAY = 10

/**
 * DSH 聊天消息流内容列（ChatView 的 .root/.scroll/.column 三层中的 .column，
 * 该元素挂着稳定契约属性 data-chat-flow，不受 CSS module 哈希变化影响）。
 * 用它做白名单可排除同在 [data-conversation-scroll] 内、但挂在 composer 上的
 * 宿主浮层（模型选择 / 访问模式等），追问只在消息正文内触发。
 */
const CHAT_FLOW_SELECTOR = '[data-chat-flow]'
/** DSH composer 的 textarea（插入后聚焦/滚动用）。 */
const INPUT_SELECTOR = '[data-input-scroll] textarea'

/**
 * 选中文字格式化为 Markdown 引用（原 _handleQuote 的格式化段）。
 * 公式渲染会在元素边界插入单个换行符（伪换行），先合并为空格，
 * 只保留双换行作为真正的段落分隔。
 * @param text - 选中的原始文字。
 * @returns 每行加 `> ` 前缀的引用文本。
 */
function formatQuote(text: string): string {
  const normalized = text
    .replace(/\n{2,}/g, '\n\n') // 标准化段落分隔为双换行
    .replace(/(?<!\n)\n(?!\n)/g, ' ') // 单个换行 → 空格（渲染产生的伪换行）
    .replace(/ {2,}/g, ' ') // 合并多余空格

  return normalized
    .split('\n')
    .map(line => (line.trim() !== '' ? `> ${line.trim()}` : '>'))
    .join('\n')
}

/** 追加引用后的最终草稿（原 _insertToInput textarea 分支的拼接规则）。 */
function appendQuoteText(existingText: string, text: string): string {
  if (existingText.trim() === '') return `${text}\n\n`
  const cleanedText = existingText.replace(/\n+$/, '')
  return `${cleanedText}\n\n${text}\n\n`
}

/**
 * 选区是否有效：必须在聊天消息流（[data-chat-flow]）内，且不在输入框/插件
 * 自身 UI 内（原 _isValidSelection，白名单从 adapter 查找的
 * conversationContainer 收窄为 ChatView 消息流内容列）。
 * @param selection - 当前选区。
 * @param buttonEl - 浮动按钮元素（排除自身）。
 * @returns 是否允许显示追问按钮。
 */
function isValidSelection(selection: Selection, buttonEl: HTMLElement | null): boolean {
  if (selection.rangeCount === 0) return false

  const container = selection.getRangeAt(0).commonAncestorContainer
  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container
  if (!(element instanceof Element)) return false

  // 排除输入框
  if (element.closest('textarea, [contenteditable="true"], input') !== null) return false

  // 排除插件自身 UI（浮动按钮 + UiHost 承载的弹窗/面板，原 .ait-quick-ask-btn /
  // .ait-panel-modal / .ait-chat-timeline-wrapper 名单的 DSH 等价物）
  if (buttonEl !== null && buttonEl.contains(element)) return false
  if (element.closest(`.${uiCss.host}`) !== null) return false

  // 白名单：选区必须在聊天消息流内容列内。之前以 [data-conversation-scroll]
  // 为界会把挂在 composer 上的宿主浮层（模型选择/访问模式等弹窗）也放行，
  // 收窄到消息流后追问只在对话正文里出现。
  const flow = document.querySelector(CHAT_FLOW_SELECTOR)
  // 兜底：宿主 DOM 契约变化导致找不到消息流容器时，放行任意选区保底可用
  // （此时仍受上方输入框/插件自身 UI 排除项约束）。
  if (flow === null || !flow.isConnected) return true

  return flow.contains(element)
}

/**
 * 根据位置类型计算坐标（原 _calculatePosition，逐分支移植）。
 * @param position - 位置类型。
 * @param rect - 选区矩形（视口坐标）。
 * @param btnWidth - 按钮宽度。
 * @param btnHeight - 按钮高度。
 * @returns 按钮的 left/top（视口坐标）。
 */
function calculatePosition(
  position: Position,
  rect: DOMRect,
  btnWidth: number,
  btnHeight: number,
): { left: number; top: number } {
  switch (position) {
    case 'topLeft':
      return { left: rect.left, top: rect.top - btnHeight - GAP }
    case 'topCenter':
      return { left: rect.left + rect.width / 2 - btnWidth / 2, top: rect.top - btnHeight - GAP }
    case 'topRight':
      return { left: rect.right - btnWidth, top: rect.top - btnHeight - GAP }
    case 'bottomLeft':
      return { left: rect.left, top: rect.bottom + GAP }
    case 'bottomCenter':
      return { left: rect.left + rect.width / 2 - btnWidth / 2, top: rect.bottom + GAP }
    case 'bottomRight':
      return { left: rect.right - btnWidth, top: rect.bottom + GAP }
  }
}

/** 是否需要回退到备选位置（原 _checkBoundary）。 */
function checkBoundary(position: Position, top: number, btnHeight: number): boolean {
  if (position.startsWith('top')) return top < MARGIN
  return top + btnHeight > window.innerHeight - MARGIN
}

/** 当前生效的选区（文字 + 定位矩形 + 保存的 Range + 是否显示复制按钮）。 */
interface ActiveSelection {
  readonly text: string
  readonly rect: DOMRect
  /** 克隆的选区（原 _savedRange，复制按钮用）。 */
  readonly range: Range
  /** 选区是否含公式（原 _syncCopyButton 的 need，显示时计算一次）。 */
  readonly hasCopy: boolean
}

/** 完整 props：输入工具行槽位运行时 + 词典。 */
export type QuickAskButtonProps = PropsRuntime<'conversation.input.left'> & PropsLocale<typeof NS>

/**
 * 追问浮动按钮。挂 composer 槽位（仅会话页存在），按钮本体 portal 到 body。
 * @param props - 槽位运行时 + 词典。
 * @returns 有有效选区时渲染浮动按钮，否则不渲染。
 */
export function QuickAskButton({ useInput, useSession, inputActions, t }: QuickAskButtonProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  // 空白会话（hero 态）没有可选正文，不挂选区监听（原 isConversationRoute 门控的快照等价物）。
  const blank = useSession(s => s.blank)
  const enabled = settings.quickAskEnabled && !blank
  const draft = useInput(s => s.draft)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const [dark, setDark] = useState(() => detectDarkTheme())
  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  const [selection, setSelection] = useState<ActiveSelection | null>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  /** 按钮按下期间跳过 selectionchange 的隐藏逻辑（原 _btnMouseDown）。 */
  const btnMouseDownRef = useRef(false)

  // ==================== 选区监听（原 _bindEvents） ====================

  useEffect(() => {
    if (!enabled) return

    const checkSelection = (): void => {
      const sel = window.getSelection()
      const text = sel !== null ? sel.toString().trim() : ''
      if (sel === null || text === '' || !isValidSelection(sel, btnRef.current)) {
        setSelection(null)
        return
      }
      const range = sel.getRangeAt(0).cloneRange()
      setSelection({
        text,
        rect: range.getBoundingClientRect(),
        range,
        hasCopy: hasRichContent(range),
      })
    }

    const onMouseUp = (e: MouseEvent): void => {
      btnMouseDownRef.current = false // 原 _docMouseUpHandler
      // 如果点击的是按钮，不处理
      if (e.target instanceof Node && btnRef.current?.contains(e.target) === true) return
      // 延迟检查，确保选区已更新
      setTimeout(checkSelection, CHECK_DELAY)
    }

    // Shift+方向键选择文字
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.shiftKey) setTimeout(checkSelection, CHECK_DELAY)
    }

    // 文字失去选中时隐藏按钮
    const onSelectionChange = (): void => {
      if (btnMouseDownRef.current) return
      const text = window.getSelection()?.toString().trim() ?? ''
      if (text === '') setSelection(null)
    }

    // 滚动时隐藏按钮
    const onScroll = (): void => { setSelection(null) }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', onScroll, { capture: true })
      setSelection(null)
    }
  }, [enabled])

  // ==================== 定位（原 _showButton） ====================

  // 先以不可见状态渲染测量真实宽度，再定位并触发入场动画。
  useLayoutEffect(() => {
    const el = btnRef.current
    if (el === null || selection === null) return

    // 已可见时（扩选/换选区）只平移到新位置，不重播入场动画
    // （原 _showButton 不摘 visible class，重复显示无淡入）
    const alreadyVisible = el.classList.contains(css.visible)
    el.style.visibility = 'hidden'
    const measured = el.getBoundingClientRect()
    const btnWidth = Math.max(measured.width, MIN_WIDTH)
    const btnHeight = Math.max(measured.height, MIN_HEIGHT)

    let { left, top } = calculatePosition(DEFAULT_POSITION, selection.rect, btnWidth, btnHeight)

    // 边界检查和回退
    if (checkBoundary(DEFAULT_POSITION, top, btnHeight)) {
      ({ left, top } = calculatePosition(POSITION_FALLBACK[DEFAULT_POSITION], selection.rect, btnWidth, btnHeight))
    }

    // 水平边界检查（通用）
    if (left < MARGIN) left = MARGIN
    if (left + btnWidth > window.innerWidth - MARGIN) {
      left = window.innerWidth - btnWidth - MARGIN
    }

    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = ''

    if (alreadyVisible) return

    // 首次显示触发入场动画
    const raf = requestAnimationFrame(() => { el.classList.add(css.visible) })
    return () => { cancelAnimationFrame(raf) }
  }, [selection])

  // ==================== 引用插入（原 _handleQuote + _insertToInput） ====================

  const handleQuote = (): void => {
    if (selection === null) return

    // 插入前先滚动到输入框并聚焦（原 _insertToInput 开头的立即滚动/聚焦）
    const input = document.querySelector<HTMLTextAreaElement>(INPUT_SELECTOR)
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    input?.focus()

    const quoted = formatQuote(selection.text)
    inputActions.setDraft(appendQuoteText(draftRef.current, quoted))

    // 隐藏按钮 + 清除选区
    setSelection(null)
    window.getSelection()?.removeAllRanges()

    // 延迟再次聚焦、光标到末尾并滚到底（原 textarea 分支的 setTimeout(50)；
    // 此时受控 textarea 的 value 已更新，光标定位才有效）
    setTimeout(() => {
      const delayed = document.querySelector<HTMLTextAreaElement>(INPUT_SELECTOR)
      if (delayed === null) return
      delayed.focus()
      delayed.selectionStart = delayed.value.length
      delayed.selectionEnd = delayed.value.length
      const scroll = delayed.closest('[data-input-scroll]')
      if (scroll !== null) scroll.scrollTop = scroll.scrollHeight
    }, 50)
  }

  // ==================== 复制（原 _handleCopy + selection-copy） ====================

  const handleCopy = (): void => {
    if (selection === null) return

    // 同步发起 clipboard.write 以保留 user gesture
    const promise = copyRange(selection.range)

    // 立即隐藏按钮，避免遮挡 toast；Toast 走屏幕居中顶部（不传 target）——
    // 因为按钮点完会立即隐藏，无可锚定元素
    setSelection(null)
    window.getSelection()?.removeAllRanges()

    promise
      .then((ok) => {
        if (ok) toast.success(t('quickAsk.copied'), null, { duration: 1600 })
        else toast.error(t('quickAsk.copyFailed'), null, { duration: 1600 })
      })
      .catch(() => {
        toast.error(t('quickAsk.copyFailed'), null, { duration: 1600 })
      })
  }

  if (!enabled || selection === null) return null

  return createPortal(
    <div
      ref={btnRef}
      className={css.btn}
      data-theme={dark ? 'dark' : 'light'}
      // preventDefault 保住选区，避免 mousedown 使正文失焦丢选区
      onMouseDown={(e) => {
        e.preventDefault()
        btnMouseDownRef.current = true
      }}
    >
      <button
        type="button"
        className={css.action}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          handleQuote()
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
        </svg>
        <span>{t('quickAsk.button')}</span>
      </button>
      {/* 复制按钮：仅当选区含公式时显示（原 _syncCopyButton） */}
      {selection.hasCopy
        ? (
          <>
            <div className={css.divider} />
            <button
              type="button"
              className={css.action}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleCopy()
              }}
            >
              {/* 视觉描边范围 y=3→21（与追问图标的 bbox 高度一致），
                  避免视觉上比其他按钮「高一截」（原 _getCopyIcon） */}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 14H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{t('quickAsk.copy')}</span>
            </button>
          </>
        )
        : null}
    </div>,
    document.body,
  )
}
