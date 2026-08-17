/**
 * 公式复制：移植原扩展 FormulaManager（formula/formula-manager.js + index.js）。
 * - 扫描 AI 回复中的 KaTeX 公式（.katex），hover 高亮 + tooltip（文字 + 设置入口）；
 * - 点击复制：LaTeX（按用户所选格式包装）/ MathML / MathML（Word 版），
 *   多个可选项时弹下拉菜单（虚拟 trigger 居中于公式上方）；
 * - 复制反馈走全局 toast；开关变化即时生效（settingsStore 订阅）；
 * - 原 DOMObserverManager 的 节流+防抖（各 2s）扫描策略以 MutationObserver 复刻；
 * - 原 url:change 清理标记 → 会话切换时清理。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { settingsStore } from '../shared/settings.ts'
import { toast } from '../ui/toast.tsx'
import { dropdown, type DropdownItem } from '../ui/dropdown.tsx'
import { panelModal } from '../panelModal/bus.ts'
import { applyFormulaFormat } from './formats.ts'
import { parseLatex, parseMathML, prefixForWord } from './parser.ts'
import uiCss from '../ui/ui.module.css'
import css from './formula.module.css'

type T = TranslateNS<typeof NS>

/** 扫描节流/防抖间隔（原 subscribeBody 的 throttle/debounce 2000ms）。 */
const SCAN_THROTTLE = 2000
const SCAN_DEBOUNCE = 2000

/** tooltip 隐藏延迟（原 tooltip-manager formula 类型 hideDelay: 200，allowHover）。 */
const TOOLTIP_HIDE_DELAY = 200

/** tooltip 配色（原 tooltip-manager formula 类型 color）。 */
const TOOLTIP_COLORS = {
  light: { backgroundColor: '#f8fafc', textColor: '#334155', borderColor: '#e2e8f0' },
  dark: { backgroundColor: '#27272a', textColor: '#e5e7eb', borderColor: '#3f3f46' },
} as const

/** 引擎回调（tooltip 显隐交由 React 宿主渲染）。 */
interface EngineHost {
  readonly isDark: () => boolean
  readonly copiedText: () => string
  readonly copyLatexLabel: () => string
  readonly copyMathMLLabel: () => string
  readonly copyMathMLWordLabel: () => string
  readonly onHover: (el: HTMLElement) => void
  readonly onLeave: (el: HTMLElement) => void
  readonly hideTooltip: () => void
}

/**
 * 公式交互引擎（原 FormulaManager 的非 UI 半）：
 * 扫描/附加监听/复制逻辑/标记清理。
 */
class FormulaEngine {
  private readonly host: EngineHost

  private observer: MutationObserver | null = null
  private lastScanAt = 0
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(host: EngineHost) {
    this.host = host
  }

  /** 初始化：处理现有公式 + 监听新增公式（原 init 的扫描半）。 */
  start(): void {
    if (this.running) return
    this.running = true
    this.scanAndAttachFormulas()
    this.observeNewFormulas()
  }

  /** 销毁：停止观察、清理标记（原 destroy）。 */
  stop(): void {
    this.running = false
    this.observer?.disconnect()
    this.observer = null
    if (this.debounceTimer !== null) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
    this.cleanupFormulaMarkers()
  }

  /** 强制重扫（原 rescan：功能重新开启时识别关闭期间生成的新公式）。 */
  rescan(): void {
    this.scanAndAttachFormulas()
  }

  /** 会话切换时清理交互标记（原 url:change 的 _handleUrlChange）。 */
  handleNavigate(): void {
    this.cleanupFormulaMarkers()
  }

  /** 主题变化时同步全部已附加公式的深色标记（原版走全局 CSS 选择器即时生效）。 */
  syncDark(dark: boolean): void {
    const value = dark ? 'true' : 'false'
    document.querySelectorAll<HTMLElement>('.katex[data-latex-source]').forEach((formula) => {
      formula.setAttribute('data-tl-dark', value)
    })
  }

  /** 扫描并附加所有未处理的 KaTeX 公式（原 scanAndAttachFormulas）。 */
  private scanAndAttachFormulas(): void {
    if (!this.running) return
    const katexFormulas = document.querySelectorAll<HTMLElement>('.katex:not([data-latex-source])')
    katexFormulas.forEach((formula) => { this.attachFormulaListeners(formula) })
  }

  /**
   * 监听新增公式：节流（持续变化每 2s 扫一次）+ 防抖（变化结束后 2s 兜底），
   * 复刻原 DOMObserverManager.subscribeBody 的策略。
   */
  private observeNewFormulas(): void {
    if (this.observer !== null) return
    this.observer = new MutationObserver((mutations) => {
      if (!mutations.some(m => m.addedNodes.length > 0)) return
      this.scheduleScan()
    })
    this.observer.observe(document.body, { childList: true, subtree: true })
  }

  private scheduleScan(): void {
    const now = Date.now()
    // 节流：leading 触发，间隔内的变化直接丢弃（原 DOMObserverManager 语义），由防抖兜底。
    if (now - this.lastScanAt >= SCAN_THROTTLE) {
      this.lastScanAt = now
      this.scanAndAttachFormulas()
    }
    // 防抖：变化结束后兜底扫描（执行时同步刷新节流时间戳，原版一致）。
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.lastScanAt = Date.now()
      this.scanAndAttachFormulas()
    }, SCAN_DEBOUNCE)
  }

  /** 为公式元素附加交互（原 attachFormulaListeners）。 */
  private attachFormulaListeners(formulaElement: HTMLElement): void {
    // 避免重复添加
    if (formulaElement.hasAttribute('data-latex-source')) return
    if (!formulaElement.isConnected) return

    // 前置提取：优先 LaTeX，失败则尝试 MathML
    let latexCode = parseLatex(formulaElement)
    if (latexCode === null || latexCode === '') {
      const mathml = parseMathML(formulaElement)
      if (mathml === null) {
        return
      }
      // 仅 MathML 可用，空字符串作为已处理标记
      latexCode = ''
    }

    // 存储 LaTeX 源码到元素属性（同时作为已处理标记）
    formulaElement.setAttribute('data-latex-source', latexCode)
    // 深色高亮标记（原版由全局 CSS 选择器驱动；主题变化经 syncDark 全量刷新）
    formulaElement.setAttribute('data-tl-dark', this.host.isDark() ? 'true' : 'false')

    formulaElement.addEventListener('mouseenter', this.handleMouseEnter)
    formulaElement.addEventListener('mouseleave', this.handleMouseLeave)
    // mousedown 捕获阶段拦截，防止进入编辑态选中
    formulaElement.addEventListener('mousedown', this.handleMouseDown, true)
    // click 捕获阶段处理复制逻辑
    formulaElement.addEventListener('click', this.handleClick, true)

    formulaElement.classList.add(css.interactive)
  }

  private readonly handleMouseEnter = (e: Event): void => {
    const formulaElement = e.currentTarget as HTMLElement
    formulaElement.classList.add(css.hover)
    this.host.onHover(formulaElement)
  }

  private readonly handleMouseLeave = (e: Event): void => {
    const formulaElement = e.currentTarget as HTMLElement
    formulaElement.classList.remove(css.hover)
    this.host.onLeave(formulaElement)
  }

  private readonly handleMouseDown = (e: Event): void => {
    // 只需阻止默认行为（原 handleMouseDown）
    e.preventDefault()
  }

  /** 点击公式复制（原 handleClick）。 */
  private readonly handleClick = (e: Event): void => {
    const formulaElement = e.currentTarget as HTMLElement

    this.host.hideTooltip()

    const settings = settingsStore.get()
    const latexEnabled = settings.formulaLatexEnabled
    const mathmlEnabled = settings.formulaMathMLEnabled
    if (!latexEnabled && !mathmlEnabled) return

    const source = formulaElement.getAttribute('data-latex-source')
    const hasLatex = source !== null && source !== ''

    // 构建可用的菜单项
    const items: DropdownItem[] = []
    if (hasLatex && latexEnabled) {
      items.push({
        label: this.host.copyLatexLabel(),
        icon: '📐',
        onClick: () => { void this.copyAsLatex(formulaElement) },
      })
    }
    if (mathmlEnabled) {
      items.push({
        label: this.host.copyMathMLLabel(),
        icon: '📊',
        onClick: () => { void this.copyAsMathML(formulaElement) },
      })
      items.push({
        label: this.host.copyMathMLWordLabel(),
        icon: '📝',
        onClick: () => { void this.copyAsMathMLForWord(formulaElement) },
      })
    }

    if (items.length === 0) return

    if (items.length === 1) {
      // 只有一个选项，直接执行
      items[0].onClick?.(items[0])
    } else {
      // 多个选项，弹出下拉菜单（虚拟 trigger 居中于公式上方，原逻辑）
      const rect = formulaElement.getBoundingClientRect()
      const dropdownWidth = 260
      const centerX = rect.left + rect.width / 2 - dropdownWidth / 2
      const virtualTrigger = document.createElement('div')
      virtualTrigger.style.cssText = `position:fixed;left:${String(centerX)}px;top:${String(rect.top)}px;width:${String(dropdownWidth)}px;height:0;pointer-events:none;`
      document.body.appendChild(virtualTrigger)

      dropdown.show({
        trigger: virtualTrigger,
        items,
        position: 'top-left',
        width: dropdownWidth,
        // 原 formula-dropdown 类：菜单项文字不截断。
        className: uiCss.dropdownNoTruncate,
      })

      setTimeout(() => { virtualTrigger.remove() }, 100)
    }
  }

  /** 复制为 LaTeX（原 _copyAsLatex）。 */
  private async copyAsLatex(formulaElement: HTMLElement): Promise<void> {
    try {
      const latexCode = formulaElement.getAttribute('data-latex-source')
      if (latexCode === null || latexCode === '') {
        this.showCopyFeedback('⚠ 无法获取公式', formulaElement, true)
        return
      }
      const formatId = settingsStore.get().formulaFormat || 'none'
      const formatted = applyFormulaFormat(latexCode, formatId)
      await navigator.clipboard.writeText(formatted)
      this.showCopyFeedback(this.host.copiedText(), formulaElement, false)
    } catch {
      this.showCopyFeedback('⚠ 复制失败', formulaElement, true)
    }
  }

  /** 复制为 MathML（原 _copyAsMathML）。 */
  private async copyAsMathML(formulaElement: HTMLElement): Promise<void> {
    try {
      const mathml = parseMathML(formulaElement)
      if (mathml === null) {
        this.showCopyFeedback('⚠ 无法获取 MathML', formulaElement, true)
        return
      }
      await writeMathMLToClipboard(mathml)
      this.showCopyFeedback(this.host.copiedText(), formulaElement, false)
    } catch {
      this.showCopyFeedback('⚠ 复制失败', formulaElement, true)
    }
  }

  /** 复制为 Word 兼容的 MathML（原 _copyAsMathMLForWord）。 */
  private async copyAsMathMLForWord(formulaElement: HTMLElement): Promise<void> {
    try {
      const mathml = parseMathML(formulaElement)
      if (mathml === null) {
        this.showCopyFeedback('⚠ 无法获取 MathML', formulaElement, true)
        return
      }
      await writeMathMLToClipboard(prefixForWord(mathml))
      this.showCopyFeedback(this.host.copiedText(), formulaElement, false)
    } catch {
      this.showCopyFeedback('⚠ 复制失败', formulaElement, true)
    }
  }

  /** 复制反馈（原 showCopyFeedback 的全局 toast 分支）。 */
  private showCopyFeedback(message: string, formulaElement: HTMLElement, isError: boolean): void {
    if (!formulaElement.isConnected) return
    if (isError) {
      toast.error(message, formulaElement, { duration: 2000 })
    } else {
      toast.success(message, formulaElement, { duration: 2000 })
    }
  }

  /** 清理所有公式的交互标记和样式类（原 _cleanupFormulaMarkers）。 */
  private cleanupFormulaMarkers(): void {
    const formulas = document.querySelectorAll<HTMLElement>('.katex[data-latex-source]')
    formulas.forEach((formula) => {
      formula.removeEventListener('mouseenter', this.handleMouseEnter)
      formula.removeEventListener('mouseleave', this.handleMouseLeave)
      formula.removeEventListener('mousedown', this.handleMouseDown, true)
      formula.removeEventListener('click', this.handleClick, true)
      formula.removeAttribute('data-latex-source')
      formula.removeAttribute('data-tl-dark')
      formula.classList.remove(css.interactive, css.hover)
    })
  }
}

/** 将 MathML 以 text/plain + text/html 双格式写入剪贴板（原双 Blob 逻辑）。 */
async function writeMathMLToClipboard(mathml: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    const htmlContent = `<html xmlns:mml="http://www.w3.org/1998/Math/MathML"><body>${mathml}</body></html>`
    const clipboardItem = new ClipboardItem({
      'text/plain': new Blob([mathml], { type: 'text/plain' }),
      'text/html': new Blob([htmlContent], { type: 'text/html' }),
    })
    await navigator.clipboard.write([clipboardItem])
  } else {
    await navigator.clipboard.writeText(mathml)
  }
}

/** FormulaHost props。 */
export interface FormulaHostProps {
  readonly t: T
  readonly dark: boolean
  /** 当前会话 id（变化时清理交互标记，对应原 url:change）。 */
  readonly currentSessionId: string | undefined
}

/**
 * 公式复制宿主：挂在 UiHost 下，承载扫描引擎与 hover tooltip 的渲染。
 * @param props - 词典 + 主题 + 当前会话。
 * @returns 公式 tooltip 或 null。
 */
export function FormulaHost({ t, dark, currentSessionId }: FormulaHostProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())

  const latexEnabled = settings.formulaLatexEnabled
  const mathmlEnabled = settings.formulaMathMLEnabled
  const enabled = latexEnabled || mathmlEnabled

  /** 当前 hover 的公式元素（tooltip 锚点）。 */
  const [tipTarget, setTipTarget] = useState<HTMLElement | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const darkRef = useRef(dark)
  darkRef.current = dark
  const tRef = useRef(t)
  tRef.current = t

  const cancelHide = (): void => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const hideTooltip = (immediate = true): void => {
    cancelHide()
    if (immediate) {
      setTipTarget(null)
      return
    }
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setTipTarget(null)
    }, TOOLTIP_HIDE_DELAY)
  }

  const engineRef = useRef<FormulaEngine | null>(null)

  // 引擎生命周期：任一开关开启时启动，全部关闭时销毁（原 index.js 的 storage 监听）。
  useEffect(() => {
    if (!enabled) return
    const engine = new FormulaEngine({
      isDark: () => darkRef.current,
      copiedText: () => tRef.current('formula.copied'),
      copyLatexLabel: () => tRef.current('formula.copyLatex'),
      copyMathMLLabel: () => tRef.current('formula.copyMathML'),
      copyMathMLWordLabel: () => tRef.current('formula.copyMathMLWord'),
      onHover: (el) => {
        cancelHide()
        setTipTarget(el)
      },
      onLeave: () => { hideTooltip(false) },
      hideTooltip: () => { hideTooltip(true) },
    })
    engineRef.current = engine
    engine.start()
    return () => {
      engine.stop()
      engineRef.current = null
      cancelHide()
      setTipTarget(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // 开关组合变化时重扫（原 rescan 分支：识别关闭期间生成的新公式）。
  useEffect(() => {
    if (enabled) engineRef.current?.rescan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latexEnabled, mathmlEnabled])

  // 主题变化时同步深色高亮标记（原版全局 CSS 选择器即时生效的等价物）。
  useEffect(() => {
    engineRef.current?.syncDark(dark)
  }, [dark])

  // 会话切换：清理旧交互标记（原 url:change 自治清理）。
  const prevSessionRef = useRef(currentSessionId)
  useEffect(() => {
    if (prevSessionRef.current === currentSessionId) return
    prevSessionRef.current = currentSessionId
    engineRef.current?.handleNavigate()
    hideTooltip(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId])

  if (tipTarget === null) return null

  // tooltip 文案随开关组合（原 _getTooltipText）。
  const tooltipText = latexEnabled && mathmlEnabled
    ? t('formula.copyGeneric')
    : (mathmlEnabled ? t('formula.copyMathML') : t('formula.copyLatex'))

  return (
    <FormulaTooltip
      target={tipTarget}
      text={tooltipText}
      settingsAria={t('formula.copyGeneric')}
      dark={dark}
      onMouseEnter={cancelHide}
      onMouseLeave={() => { hideTooltip(false) }}
      onHide={() => { hideTooltip(true) }}
    />
  )
}

interface FormulaTooltipProps {
  readonly target: HTMLElement
  readonly text: string
  readonly settingsAria: string
  readonly dark: boolean
  readonly onMouseEnter: () => void
  readonly onMouseLeave: () => void
  readonly onHide: () => void
}

/** 公式 tooltip：文字 + 设置入口（原 _buildTooltipContent + showTooltip 定位）。 */
function FormulaTooltip({ target, text, settingsAria, dark, onMouseEnter, onMouseLeave, onHide }: FormulaTooltipProps) {
  const ref = useRef<HTMLDivElement>(null)

  // 定位：恒定上方（原 globalTooltipManager 主路径：formula 类型显式 top、不翻转，
  // 越界仅按 8px 四边钳制，坐标取整，箭头偏移补偿）。
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null || !target.isConnected) return
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const tipRect = el.getBoundingClientRect()
    const pad = 8

    let top = Math.round(rect.top - tipRect.height - 12)
    let left = Math.round(rect.left + rect.width / 2 - tipRect.width / 2)

    if (left < pad) {
      left = pad
    } else if (left + tipRect.width > window.innerWidth - pad) {
      left = window.innerWidth - tipRect.width - pad
    }
    if (top < pad) {
      top = pad
    } else if (top + tipRect.height > window.innerHeight - pad) {
      top = window.innerHeight - tipRect.height - pad
    }

    el.setAttribute('data-placement', 'top')

    // 箭头对准公式中心（钳制修正后偏移，原 _calculateArrowOffset）。
    const arrowOffset = Math.max(12, Math.min(tipRect.width - 12, rect.left + rect.width / 2 - left))
    el.style.setProperty('--arrow-offset', `${String(arrowOffset)}px`)
    el.style.left = `${String(left)}px`
    el.style.top = `${String(top)}px`
    requestAnimationFrame(() => { el.classList.add(css.tooltipVisible) })
  }, [target, text])

  // 安全网：滚动 / 点击外部 / ESC / 窗口失焦 / 目标移出视口或被删除时隐藏
  // （原 _setupGlobalListeners + _observeTarget）。
  useEffect(() => {
    const onScroll = (): void => { onHide() }
    const onClick = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (ref.current !== null && (t === ref.current || ref.current.contains(t))) return
      if (t === target || target.contains(t)) return
      onHide()
    }
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onHide()
    }
    const onBlur = (): void => { onHide() }
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('blur', onBlur)
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) onHide()
      }
    }, { threshold: 0 })
    io.observe(target)
    // 目标被移出 DOM 时隐藏（原 _observeTarget 的 MutationObserver 兜底）。
    const mo = new MutationObserver(() => {
      if (!target.isConnected) onHide()
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeydown)
      window.removeEventListener('blur', onBlur)
      io.disconnect()
      mo.disconnect()
    }
  }, [target, onHide])

  const colors = dark ? TOOLTIP_COLORS.dark : TOOLTIP_COLORS.light

  return (
    <div
      ref={ref}
      className={css.tooltip}
      role="tooltip"
      data-placement="top"
      data-tooltip-theme={dark ? 'dark' : 'light'}
      style={{
        '--formula-tooltip-bg': colors.backgroundColor,
        '--formula-tooltip-text': colors.textColor,
        '--formula-tooltip-border': colors.borderColor,
      } as React.CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={css.content}>
        <span className={css.text}>{text}</span>
        <button
          type="button"
          className={css.settingsBtn}
          aria-label={settingsAria}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onHide()
            panelModal.show('formula')
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </div>
  )
}
