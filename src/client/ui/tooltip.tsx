/**
 * 全局 Tooltip：移植原扩展 GlobalTooltipManager 的 button 型 tooltip
 * 与二级悬浮 mini tooltip（showOverlay）。
 * - button 型：showDelay 0 / hideDelay 100、placement 默认 bottom、gap 12、
 *   auto 时按 左>右>上>下 择位、视口 8px 边界修正、箭头随修正偏移；
 * - 安全网：滚动/点击外部/ESC/窗口失焦 强制隐藏；目标移出视口隐藏；
 * - mini：小号无箭头黑底提示（主 tooltip 内图标 hover 用），支持 light 反转。
 * 注：原 node 型 tooltip 已由时间轴 DotTooltip 组件化承载。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Bus } from './bus.ts'
import css from './ui.module.css'

/** tooltip 配色（light/dark 两套，原 config.types.button.color）。 */
const BUTTON_COLORS = {
  light: { backgroundColor: '#f8fafc', textColor: '#334155', borderColor: '#e2e8f0' },
  dark: { backgroundColor: '#27272a', textColor: '#e5e7eb', borderColor: '#3f3f46' },
} as const

/** 单套 tooltip 配色。 */
export interface TooltipColor {
  readonly backgroundColor: string
  readonly textColor: string
  readonly borderColor: string
}

/** show 的可选配置。 */
export interface TooltipOptions {
  readonly placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right'
  readonly maxWidth?: number
  readonly showDelay?: number
  readonly hideDelay?: number
  readonly gap?: number
  readonly noArrow?: boolean
  /** 尺寸档位（控制内边距与字号），缺省 medium 即原始样式。 */
  readonly size?: 'small' | 'medium' | 'large'
  /**
   * 自定义配色，缺省用 BUTTON_COLORS（原 show 的 color 形态）。
   * 传 { light, dark } 按页面主题选用；直接传一套 TooltipColor 则不随主题、固定生效。
   */
  readonly color?: TooltipColor | { readonly light: TooltipColor; readonly dark: TooltipColor }
}

interface TooltipState {
  readonly id: string
  readonly target: HTMLElement
  /** 文本或富内容（原 show 的 html 形态由 ReactNode 承载）。 */
  readonly content: React.ReactNode
  readonly options: TooltipOptions
}

interface MiniState {
  readonly target: HTMLElement
  readonly text: string
  readonly placement: 'top' | 'bottom'
  readonly theme: 'light' | 'dark' | null
}

const tipBus = new Bus<TooltipState | null>(null)
const miniBus = new Bus<MiniState | null>(null)

let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearTimers(): void {
  if (showTimer !== null) { clearTimeout(showTimer); showTimer = null }
  if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null }
}

/** 命令式 Tooltip API（等价原 window.globalTooltipManager 的 button/overlay 面）。 */
export const tooltip = {
  /** 显示 button 型 tooltip（原 show(id,'button',target,content)，富内容对应原 html 形态）。 */
  show(id: string, target: HTMLElement, content: React.ReactNode, options: TooltipOptions = {}): void {
    if (!target.isConnected || content === '' || content === null || content === undefined) return
    const current = tipBus.get()
    if (current !== null && current.id === id) return
    clearTimers()
    const delay = options.showDelay ?? 0
    showTimer = setTimeout(() => {
      showTimer = null
      if (!target.isConnected) return
      tipBus.set({ id, target, content, options })
    }, delay)
  },
  hide(immediate = false): void {
    if (showTimer !== null) { clearTimeout(showTimer); showTimer = null }
    if (immediate) {
      if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null }
      tipBus.set(null)
      return
    }
    const delay = tipBus.get()?.options.hideDelay ?? 100
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      hideTimer = null
      tipBus.set(null)
    }, delay)
  },
  forceHideAll(): void {
    clearTimers()
    tipBus.set(null)
    miniBus.set(null)
  },
  isShowing(id: string): boolean {
    return tipBus.get()?.id === id
  },
  /** 二级悬浮 mini tooltip（原 showOverlay）。 */
  showOverlay(target: HTMLElement, text: string, options: { placement?: 'top' | 'bottom'; theme?: 'light' | 'dark' } = {}): void {
    if (!target.isConnected) return
    let theme: 'light' | 'dark' | null = options.theme ?? null
    if (theme === null) {
      const parent = target.closest('[data-tooltip-theme]')
      if (parent !== null) {
        theme = parent.getAttribute('data-tooltip-theme') === 'dark' ? 'dark' : 'light'
      }
    }
    miniBus.set({ target, text, placement: options.placement ?? 'top', theme })
  },
  hideOverlay(): void {
    miniBus.set(null)
  },
}

/** 择位（原 _chooseBestPlacement：左>右>上>下）。 */
function chooseBestPlacement(targetRect: DOMRect, tipRect: DOMRect): 'left' | 'right' | 'top' | 'bottom' {
  const space = {
    left: targetRect.left,
    right: window.innerWidth - targetRect.right,
    top: targetRect.top,
    bottom: window.innerHeight - targetRect.bottom,
  }
  const padding = 20
  if (space.left >= tipRect.width + padding) return 'left'
  if (space.right >= tipRect.width + padding) return 'right'
  if (space.top >= tipRect.height + padding) return 'top'
  return 'bottom'
}

/**
 * Tooltip 宿主。
 * @param props - dark 为宿主主题。
 * @returns button 型 tooltip + mini tooltip。
 */
export function TooltipHost({ dark }: { readonly dark: boolean }) {
  const busTip = useSyncExternalStore(tipBus.subscribe, () => tipBus.get())
  const mini = useSyncExternalStore(miniBus.subscribe, () => miniBus.get())
  const tipRef = useRef<HTMLDivElement>(null)
  const miniRef = useRef<HTMLDivElement>(null)

  // ==== 隐藏淡出（原 _hideImmediate：移除 visible 类淡出，200ms 后销毁 DOM） ====
  const [tip, setTip] = useState<TooltipState | null>(busTip)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useLayoutEffect(() => {
    if (busTip !== null) {
      // 新 tooltip：立即替换（原版销毁旧实例重建，无并存过渡）。
      if (leaveTimerRef.current !== null) {
        clearTimeout(leaveTimerRef.current)
        leaveTimerRef.current = null
      }
      setTip(busTip)
      return
    }
    if (tip === null) return
    // 隐藏：先移除 visible 类触发 0.15s 淡出，200ms 后卸载（原 cleanupAnimation）。
    tipRef.current?.classList.remove(css.tooltipVisible)
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null
      setTip(null)
    }, 200)
    return () => {
      if (leaveTimerRef.current !== null) {
        clearTimeout(leaveTimerRef.current)
        leaveTimerRef.current = null
      }
    }
    // tip 仅在本效应内派生更新，无需作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busTip])

  // ==== 主 tooltip 定位（移植 _showImmediate + _calculatePosition） ====
  useLayoutEffect(() => {
    const el = tipRef.current
    if (el === null || tip === null) return
    // 切换目标时重新淡入（原版销毁旧 DOM 后新实例从隐藏态 rAF 淡入）。
    el.classList.remove(css.tooltipVisible)
    const targetRect = tip.target.getBoundingClientRect()
    const tipRect = el.getBoundingClientRect()
    const gap = tip.options.gap ?? 12
    let placement = tip.options.placement ?? 'bottom'
    if (placement === 'auto') placement = chooseBestPlacement(targetRect, tipRect)

    let left: number
    let top: number
    switch (placement) {
      case 'left':
        left = targetRect.left - tipRect.width - gap
        top = targetRect.top + (targetRect.height - tipRect.height) / 2
        break
      case 'right':
        left = targetRect.right + gap
        top = targetRect.top + (targetRect.height - tipRect.height) / 2
        break
      case 'top':
        left = targetRect.left + (targetRect.width - tipRect.width) / 2
        top = targetRect.top - tipRect.height - gap
        break
      default:
        left = targetRect.left + (targetRect.width - tipRect.width) / 2
        top = targetRect.bottom + gap
    }
    left = Math.round(left)
    top = Math.round(top)

    // 边界修正（原 _clampToBounds，padding 8）。
    const pad = 8
    if (left < pad) left = pad
    else if (left + tipRect.width > window.innerWidth - pad) left = window.innerWidth - tipRect.width - pad
    if (top < pad) top = pad
    else if (top + tipRect.height > window.innerHeight - pad) top = window.innerHeight - tipRect.height - pad

    // 箭头偏移（原 _calculateArrowOffset）。
    const targetCenterX = targetRect.left + targetRect.width / 2
    const targetCenterY = targetRect.top + targetRect.height / 2
    let arrowOffset = '50%'
    if (placement === 'top' || placement === 'bottom') {
      const offsetPx = targetCenterX - left
      arrowOffset = `${Math.max(12, Math.min(tipRect.width - 12, offsetPx))}px`
    } else {
      const offsetPx = targetCenterY - top
      arrowOffset = `${Math.max(12, Math.min(tipRect.height - 12, offsetPx))}px`
    }

    el.setAttribute('data-placement', placement)
    el.style.setProperty('--arrow-offset', arrowOffset)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    requestAnimationFrame(() => { el.classList.add(css.tooltipVisible) })
  }, [tip])

  // ==== 安全网：滚动/点击/ESC/失焦 隐藏（移植 _setupGlobalListeners） ====
  useEffect(() => {
    if (tip === null) return
    const onScroll = (): void => { tooltip.forceHideAll() }
    const onClick = (e: MouseEvent): void => {
      const t = e.target
      if (t instanceof Node && (tip.target === t || tip.target.contains(t))) return
      if (tipRef.current !== null && t instanceof Node && tipRef.current.contains(t)) return
      tooltip.hide(true)
    }
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') tooltip.forceHideAll()
    }
    const onBlur = (): void => { tooltip.forceHideAll() }
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('blur', onBlur)

    // 目标移出视口时隐藏（移植 IntersectionObserver 安全网）。
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) tooltip.forceHideAll()
      }
    }, { threshold: 0 })
    io.observe(tip.target)

    return () => {
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeydown)
      window.removeEventListener('blur', onBlur)
      io.disconnect()
    }
  }, [tip])

  // ==== mini tooltip 定位（移植 showOverlay） ====
  useLayoutEffect(() => {
    const el = miniRef.current
    if (el === null || mini === null) return
    const targetRect = mini.target.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const gap = 6
    let top: number
    let left: number
    if (mini.placement === 'top') {
      top = targetRect.top - elRect.height - gap
      left = targetRect.left + (targetRect.width - elRect.width) / 2
    } else {
      top = targetRect.bottom + gap
      left = targetRect.left + (targetRect.width - elRect.width) / 2
    }
    if (left < 4) left = 4
    if (left + elRect.width > window.innerWidth - 4) left = window.innerWidth - elRect.width - 4
    if (top < 4) top = targetRect.bottom + gap
    el.style.top = `${top}px`
    el.style.left = `${left}px`
    requestAnimationFrame(() => { el.classList.add(css.tooltipVisible) })
  }, [mini])

  const custom = tip?.options.color
  const palette = custom === undefined
    ? BUTTON_COLORS
    // 单套形态（无 light 键）视为固定配色，两个主题共用。
    : 'light' in custom ? custom : { light: custom, dark: custom }
  const colors = dark ? palette.dark : palette.light

  return (
    <>
      {tip !== null
        ? (
          <div
            ref={tipRef}
            className={[
              css.tooltipBase,
              tip.options.noArrow === true ? css.tooltipNoArrow : '',
              tip.options.size === 'small' ? css.tooltipSmall : '',
              tip.options.size === 'large' ? css.tooltipLarge : '',
            ].filter(Boolean).join(' ')}
            role="tooltip"
            data-tooltip-theme={dark ? 'dark' : 'light'}
            style={{
              // 原版 config 的 200 为死配置，实际由 CSS .timeline-tooltip-base 的 400px 生效。
              maxWidth: `${tip.options.maxWidth ?? 400}px`,
              backgroundColor: colors.backgroundColor,
              color: colors.textColor,
              borderColor: colors.borderColor,
              '--ui-tooltip-bg': colors.backgroundColor,
              '--ui-tooltip-text': colors.textColor,
              '--ui-tooltip-border': colors.borderColor,
            } as React.CSSProperties}
          >
            {tip.content}
          </div>
        )
        : null}
      {mini !== null
        ? (
          <div
            ref={miniRef}
            className={css.tooltipMini}
            data-mini-theme={mini.theme ?? undefined}
          >
            {mini.text}
          </div>
        )
        : null}
    </>
  )
}
