/**
 * 全局 Toast：移植原扩展 GlobalToastManager。
 * - 四种类型（success/error/info/warning），配色/图标/时长逐参数保留；
 * - 队列管理：最多同时 3 个，居中 toast 自上而下堆叠（起始 60px、间距 10px）；
 * - 相对定位：传 target 时贴目标元素 top/bottom/left/right + gap，视口边界 8px 修正；
 * - className/iconType/useClassStyles 支持 AI 完成提醒的胶囊样式。
 * 命令式 API（toast.success 等）+ React 宿主（ToastHost，挂 shell.overlay）。
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { Bus } from './bus.ts'
import css from './ui.module.css'

/** toast 类型。 */
export type ToastType = 'success' | 'error' | 'info' | 'warning'

/** 主题配色（原 config.types[type].color）。 */
interface ToastColors {
  readonly backgroundColor: string
  readonly textColor: string
  readonly borderColor: string
}

/** show 的可选配置（与原版对齐）。 */
export interface ToastOptions {
  /** 目标元素（相对定位）；不传则屏幕中央堆叠。 */
  readonly target?: HTMLElement | null
  readonly duration?: number
  readonly position?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  /** 传 false 跳过内联配色（由 className 的 CSS 接管）。 */
  readonly color?: { readonly light: ToastColors; readonly dark: ToastColors } | false
  readonly icon?: string
  readonly gap?: number
  readonly className?: string
  /** 内置图标类型（check 为 SVG 对勾，优先于 icon）。 */
  readonly iconType?: 'check'
  /** 跳过默认视觉样式，由 CSS 类接管（AI 完成胶囊用）。 */
  readonly useClassStyles?: boolean
}

interface TypeConfig {
  readonly color: { readonly light: ToastColors; readonly dark: ToastColors }
  readonly icon: string
  readonly duration: number
  readonly position: 'top' | 'bottom' | 'left' | 'right' | 'center'
  readonly gap: number
}

/** 原版 config（逐参数移植）。 */
const CONFIG = {
  maxVisible: 3,
  stackGap: 10,
  centerGap: 60,
  types: {
    success: {
      color: {
        light: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
        dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
      },
      icon: '✓', duration: 1000, position: 'top', gap: 10,
    },
    error: {
      color: {
        light: { backgroundColor: '#0d0d0d', textColor: '#ffffff', borderColor: '#0d0d0d' },
        dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
      },
      icon: '⚠', duration: 1500, position: 'top', gap: 10,
    },
    info: {
      color: {
        light: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
        dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
      },
      icon: '✓', duration: 2000, position: 'top', gap: 10,
    },
    warning: {
      color: {
        light: { backgroundColor: '#0d0d0d', textColor: '#ffffff', borderColor: '#0d0d0d' },
        dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
      },
      icon: '⚡', duration: 2000, position: 'top', gap: 10,
    },
  } satisfies Record<ToastType, TypeConfig>,
} as const

/** 类型默认值与调用方覆盖合并后的最终配置。 */
interface ResolvedToastConfig extends ToastOptions {
  readonly duration: number
  readonly position: 'top' | 'bottom' | 'left' | 'right' | 'center'
  readonly gap: number
  readonly icon: string
  readonly color: { readonly light: ToastColors; readonly dark: ToastColors } | false
}

interface ToastInstance {
  readonly id: number
  readonly message: string
  readonly config: ResolvedToastConfig
  /** 隐藏动画中。 */
  readonly leaving: boolean
}

let nextId = 1
const bus = new Bus<readonly ToastInstance[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function remove(id: number, immediate: boolean): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const current = bus.get().find(t => t.id === id)
  if (current === undefined) return
  if (immediate) {
    bus.update(list => list.filter(t => t.id !== id))
    return
  }
  bus.update(list => list.map(t => (t.id === id ? { ...t, leaving: true } : t)))
  const cleanupDelay = current.config.useClassStyles === true ? 320 : 200
  setTimeout(() => {
    bus.update(list => list.filter(t => t.id !== id))
  }, cleanupDelay)
}

function show(type: ToastType, message: string, options: ToastOptions = {}): void {
  if (message === '') return
  const typeConfig = CONFIG.types[type]
  const config = { ...typeConfig, ...options }
  const id = nextId++
  bus.update((list) => {
    // 退场中的实例保留至动画播完（原版仅从队列移除，DOM 留到动画结束）。
    let next = [...list, { id, message, config, leaving: false }]
    // 超出上限时立即移除最早的活动 toast（原版 shift + 立即隐藏，无退出动画）。
    const active = next.filter(t => !t.leaving)
    if (active.length > CONFIG.maxVisible) {
      const oldest = active[0]
      next = next.filter(t => t.id !== oldest.id)
      const timer = timers.get(oldest.id)
      if (timer !== undefined) {
        clearTimeout(timer)
        timers.delete(oldest.id)
      }
    }
    return next
  })
  timers.set(id, setTimeout(() => { remove(id, false) }, config.duration))
}

/** 命令式 Toast API（等价原 window.globalToastManager）。 */
export const toast = {
  show,
  success: (message: string, target: HTMLElement | null = null, options: ToastOptions = {}) => {
    show('success', message, { target, ...options })
  },
  error: (message: string, target: HTMLElement | null = null, options: ToastOptions = {}) => {
    show('error', message, { target, ...options })
  },
  info: (message: string, target: HTMLElement | null = null, options: ToastOptions = {}) => {
    show('info', message, { target, ...options })
  },
  warning: (message: string, target: HTMLElement | null = null, options: ToastOptions = {}) => {
    show('warning', message, { target, ...options })
  },
  forceHideAll: () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    bus.set([])
  },
}

/** check 图标（原 _createIconElement）。 */
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.75 7.25L5.75 10.25L11.25 3.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Toast 宿主：渲染队列并按原版算法定位。
 * @param props - dark 为宿主主题（决定 light/dark 配色取值）。
 * @returns toast 列表。
 */
export function ToastHost({ dark }: { readonly dark: boolean }) {
  const list = useSyncExternalStore(bus.subscribe, () => bus.get())
  const refs = useRef(new Map<number, HTMLDivElement>())
  const shown = useRef(new Set<number>())

  // 位置计算（移植 _updatePositions：居中堆叠 + 相对目标定位 + 边界修正）。
  // 退场中的 toast 不参与计算、位置冻结原地淡出（原版队列只含活动实例）。
  useLayoutEffect(() => {
    const centerToasts = list.filter(t => t.config.target == null && !t.leaving)
    const relativeToasts = list.filter(t => t.config.target != null && !t.leaving)

    centerToasts.forEach((t, index) => {
      const el = refs.current.get(t.id)
      if (el === undefined) return
      const rect = el.getBoundingClientRect()
      const top = CONFIG.centerGap + index * (rect.height + CONFIG.stackGap)
      const left = (window.innerWidth - rect.width) / 2
      el.style.left = `${left}px`
      el.style.top = `${top}px`
    })

    for (const t of relativeToasts) {
      const el = refs.current.get(t.id)
      const target = t.config.target
      if (el === undefined || target == null) continue
      if (!target.isConnected) {
        remove(t.id, true)
        continue
      }
      const targetRect = target.getBoundingClientRect()
      const toastRect = el.getBoundingClientRect()
      const gap = t.config.gap ?? 10
      let x: number
      let y: number
      switch (t.config.position) {
        case 'bottom':
          x = targetRect.left + (targetRect.width - toastRect.width) / 2
          y = targetRect.bottom + gap
          break
        case 'left':
          x = targetRect.left - toastRect.width - gap
          y = targetRect.top + (targetRect.height - toastRect.height) / 2
          break
        case 'right':
          x = targetRect.right + gap
          y = targetRect.top + (targetRect.height - toastRect.height) / 2
          break
        default:
          x = targetRect.left + (targetRect.width - toastRect.width) / 2
          y = targetRect.top - toastRect.height - gap
      }
      const padding = 8
      x = Math.max(padding, Math.min(x, window.innerWidth - toastRect.width - padding))
      y = Math.max(padding, Math.min(y, window.innerHeight - toastRect.height - padding))
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }

    // 定位完成后下一帧加 visible（原版 requestAnimationFrame）；
    // leaving 时移除 visible 触发退出过渡（原版 _hideToast）。
    for (const t of list) {
      const el = refs.current.get(t.id)
      if (el === undefined) continue
      if (t.leaving) {
        el.classList.remove(css.toastVisible)
        continue
      }
      if (shown.current.has(t.id)) continue
      shown.current.add(t.id)
      requestAnimationFrame(() => { el.classList.add(css.toastVisible) })
    }
    for (const id of [...shown.current]) {
      if (!list.some(t => t.id === id)) shown.current.delete(id)
    }
  }, [list])

  return (
    <>
      {list.map((t) => {
        const useClass = t.config.useClassStyles === true
        const colors = t.config.color === false
          ? null
          : (dark ? (t.config.color ?? CONFIG.types.info.color).dark : (t.config.color ?? CONFIG.types.info.color).light)
        const classNames = [
          css.toast,
          useClass ? '' : css.toastDefaultVisual,
          t.config.className === 'ait-ai-complete-toast' ? css.toastAiComplete : '',
          // 原版将 className 原样附加到元素上（任意类名透传）。
          t.config.className ?? '',
        ].filter(Boolean).join(' ')
        return (
          <div
            key={t.id}
            ref={(el) => {
              if (el !== null) refs.current.set(t.id, el)
              else refs.current.delete(t.id)
            }}
            className={classNames}
            style={colors !== null && !useClass
              ? {
                  backgroundColor: colors.backgroundColor,
                  color: colors.textColor,
                  border: `1px solid ${colors.borderColor}`,
                  ...(t.leaving ? { opacity: 0, transform: 'translateY(-10px)' } : {}),
                }
              : undefined}
          >
            {t.config.iconType === 'check'
              ? <span className={css.toastIcon}><CheckIcon /></span>
              : (t.config.icon !== undefined && t.config.icon !== ''
                  ? <span className={css.toastIcon}>{t.config.icon}</span>
                  : null)}
            <span>{t.message}</span>
          </div>
        )
      })}
    </>
  )
}
