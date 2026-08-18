/**
 * 时间轴轴条：圆点按消息实际位置成比例摆放（visualN），经 minGap 双向修正，
 * 密度过高时切换紧凑横线模式；轨道内容可高于可视区，随主滚动联动。
 * hover 圆点浮出问题气泡（时间 + 全文 + 收藏操作，点击文本复制）。
 * 全部算法移植自原扩展 TimelineManager（engine.ts）。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { computeActiveIndex, computeGeometry, computeVisibleRange, LAYOUT } from './engine.ts'
import type { StarRecord } from './store.ts'
import { DotTooltip } from './DotTooltip.tsx'
import css from './timeline.module.css'

/** 时间轴上的一个提问节点。 */
export interface TimelineItem {
  /** Chat 节点 key（同时是 DOM 上的 data-chat-flow-key 锚点）。 */
  readonly key: string
  /** 摘要全文（行数截断由展示层负责）。 */
  readonly title: string
  /** 提问时间（Unix epoch ms）。 */
  readonly time: number
  /** 随后一条可见助手回复的正文预览；尚无回复时为空。 */
  readonly reply: string
}

/** 轴条组件 props。 */
export interface TimelineBarProps {
  readonly items: readonly TimelineItem[]
  readonly starred: Record<string, StarRecord>
  /** 已标记图钉的节点 key 集合。 */
  readonly pinned: ReadonlySet<string>
  readonly activeKey: string | null
  /** AI 是否正在生成（底部 padding 生成中冻结，原 isAIGenerating）。 */
  readonly running: boolean
  readonly onActiveChange: (key: string | null) => void
  readonly onJump: (key: string) => void
  readonly onToggleStar: (item: TimelineItem) => void
  readonly onTogglePin: (item: TimelineItem) => void
  readonly t: TranslateNS<typeof NS>
}

/** 长按图钉触发时长（原版代码硬编码 500ms，非 config 的 550）。 */
const LONG_PRESS_MS = 500
/** 长按移动容差（原版代码硬编码 5px）。 */
const LONG_PRESS_TOLERANCE = 5
/** 底部 padding 更新防抖（原 debouncedUpdateScrollPadding 的 500ms）。 */
const PADDING_DEBOUNCE = 500
/** 底部 padding 元素 class（原 ait-scroll-padding）。 */
const PADDING_CLASS = 'dsh-tl-scroll-padding'

/**
 * 查找会话滚动容器（宿主 DOM 锚点）。
 * @returns 滚动容器；不存在时 null。
 */
export function findScrollContainer(): HTMLElement | null {
  const el = document.querySelector('[data-conversation-scroll]')
  return el instanceof HTMLElement ? el : null
}

/**
 * 按 Chat 节点 key 查找消息元素。
 * @param key - Chat 节点 key。
 * @returns 消息元素；不存在时 null。
 */
export function findMessageElement(key: string): HTMLElement | null {
  const el = document.querySelector(`[data-chat-flow-key="${CSS.escape(key)}"]`)
  return el instanceof HTMLElement ? el : null
}

/** tooltip 悬停目标。 */
interface HoverTarget {
  readonly item: TimelineItem
  /** 圆点的视口矩形（tooltip 定位锚点）。 */
  readonly anchorRect: DOMRect
}

/**
 * 时间轴轴条。
 * @param props - 节点、收藏集、激活态与回调。
 * @returns 轴条（含 tooltip）。
 */
export function TimelineBar({ items, starred, pinned, activeKey, running, onActiveChange, onJump, onToggleStar, onTogglePin, t }: TimelineBarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<{ dotNs: readonly number[]; contentHeight: number; compact: boolean }>(
    { dotNs: [], contentHeight: 0, compact: false },
  )
  /** 虚拟化可见区间（原 visibleRange，含前后 buffer）。 */
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number }>({ start: 0, end: -1 })
  const [hover, setHover] = useState<HoverTarget | null>(null)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const compactRef = useRef(false)
  const offsetTopsRef = useRef<number[]>([])
  const lastActiveChangeRef = useRef(0)
  const pendingActiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(running)
  runningRef.current = running
  const onTogglePinRef = useRef(onTogglePin)
  onTogglePinRef.current = onTogglePin
  /** 长按已触发标志：吞掉随后的 click（原 longPressTriggered）。 */
  const longPressTriggeredRef = useRef(false)

  // ==== 几何重算（rAF 节流；移植 _recalcMarkerPositions + updateTimelineGeometry） ====
  const recompute = useCallback(() => {
    const port = findScrollContainer()
    const bar = barRef.current
    if (port === null || bar === null) return
    const list = itemsRef.current
    if (list.length === 0) return

    const containerRect = port.getBoundingClientRect()
    const containerScrollTop = port.scrollTop
    const offsets: number[] = []
    for (const item of list) {
      const el = findMessageElement(item.key)
      if (el === null) {
        offsets.push(offsets.length > 0 ? offsets[offsets.length - 1] : 0)
        continue
      }
      offsets.push(el.getBoundingClientRect().top - containerRect.top + containerScrollTop)
    }
    offsetTopsRef.current = offsets

    const first = offsets[0]
    const span = (offsets[offsets.length - 1] - first) || 1
    const visualNs = offsets.map(top => Math.max(0, Math.min(1, (top - first) / span)))

    const barHeight = bar.clientHeight
    const next = computeGeometry(visualNs, barHeight, compactRef.current)
    compactRef.current = next.compact
    setGeometry(next)
  }, [])

  // ==== 激活节点计算（移植 computeActiveByScroll，含 120ms 变更防抖） ====
  const updateActive = useCallback(() => {
    const port = findScrollContainer()
    if (port === null) return
    const index = computeActiveIndex(offsetTopsRef.current, port.scrollTop)
    const key = index >= 0 ? (itemsRef.current[index]?.key ?? null) : null
    if (key === null) return

    const commit = (): void => {
      lastActiveChangeRef.current = performance.now()
      onActiveChange(key)
    }
    const since = performance.now() - lastActiveChangeRef.current
    if (since < LAYOUT.MIN_ACTIVE_CHANGE_INTERVAL) {
      if (pendingActiveTimerRef.current !== null) clearTimeout(pendingActiveTimerRef.current)
      pendingActiveTimerRef.current = setTimeout(() => {
        pendingActiveTimerRef.current = null
        updateActive()
      }, LAYOUT.MIN_ACTIVE_CHANGE_INTERVAL - since)
      return
    }
    commit()
  }, [onActiveChange])

  // ==== 虚拟化：仅渲染可视区 ± buffer 内的圆点（移植 updateVirtualRangeAndRender） ====
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const updateVirtualRange = useCallback(() => {
    const track = trackRef.current
    if (track === null) return
    const { dotNs, contentHeight } = geometryRef.current
    const pad = LAYOUT.TRACK_PADDING
    const usable = Math.max(1, contentHeight - 2 * pad)
    const yPositions = dotNs.map(n => pad + n * usable)
    const next = computeVisibleRange(yPositions, track.scrollTop, track.clientHeight)
    setVisibleRange(prev => (prev.start === next.start && prev.end === next.end ? prev : next))
  }, [])

  // 几何变化后同步重算可见区间。
  useEffect(() => { updateVirtualRange() }, [geometry, updateVirtualRange])

  // ==== 轨道随主滚动联动（移植 syncTimelineTrackToMain：45% 参考线映射） ====
  const syncTrack = useCallback(() => {
    const port = findScrollContainer()
    const track = trackRef.current
    if (port === null || track === null) return
    const offsets = offsetTopsRef.current
    if (offsets.length === 0) return
    // span = last - first（原 contentSpanPx）；参考线相对滚动原点归一化——
    // 原版 firstUserTurnOffset 恒为 0（初始化后从未赋值），保真保留该行为。
    const span = Math.max(1, offsets[offsets.length - 1] - offsets[0])
    const ref = port.scrollTop + port.clientHeight * 0.45
    const r = Math.max(0, Math.min(1, ref / span))
    const maxScroll = Math.max(0, track.scrollHeight - track.clientHeight)
    const target = Math.round(r * maxScroll)
    // 变化 > 1px 才写入（原版微优化，避免无谓抖动写）。
    if (Math.abs(track.scrollTop - target) > 1) track.scrollTop = target
  }, [])

  // ==== 底部空白 padding：保证最后节点可滚动激活（移植 _updateScrollPadding） ====
  const updateScrollPadding = useCallback(() => {
    const port = findScrollContainer()
    const column = document.querySelector('[data-chat-flow]')
    if (port === null || !(column instanceof HTMLElement)) return

    // 节点数 <= 1 不需要 padding，移除已存在元素（原版分支）。
    if (itemsRef.current.length <= 1) {
      const existing = column.querySelector(`.${PADDING_CLASS}`)
      if (existing !== null) existing.remove()
      return
    }

    let paddingEl = column.querySelector<HTMLElement>(`.${PADDING_CLASS}`)
    if (paddingEl === null) {
      paddingEl = document.createElement('div')
      paddingEl.className = PADDING_CLASS
      paddingEl.style.cssText = 'pointer-events: none; width: 100%; flex-shrink: 0; order: 9999; height: 0; transition: height 0.3s ease-out;'
    }

    // 定位：reverse 布局 prepend；flex 布局插在最后一个子元素之前（避免成为
    // lastChild 干扰宿主自动滚动）；否则 append（原版逐分支移植）。
    const columnStyle = window.getComputedStyle(column)
    if (columnStyle.flexDirection === 'column-reverse') {
      if (paddingEl !== column.firstElementChild) column.prepend(paddingEl)
    } else if (/flex/.test(columnStyle.display)) {
      const tailEl = column.lastElementChild
      if (tailEl === null) {
        column.appendChild(paddingEl)
      } else if (tailEl === paddingEl) {
        let anchor = paddingEl.previousElementSibling
        while (anchor !== null && anchor.classList.contains(PADDING_CLASS)) {
          anchor = anchor.previousElementSibling
        }
        if (anchor !== null) column.insertBefore(paddingEl, anchor)
      } else if (paddingEl.parentElement !== column || paddingEl.nextElementSibling !== tailEl) {
        column.insertBefore(paddingEl, tailEl)
      }
    } else if (paddingEl !== column.lastElementChild) {
      column.appendChild(paddingEl)
    }

    // AI 生成中保持高度不变（原 aiGeneratingState === true 分支）。
    if (runningRef.current) return

    // 生成结束：padding = ceil(max(0, lastOffsetTop - 120 + 20 - cleanMaxScrollTop))。
    // cleanMaxScrollTop 扣除 padding 的实际渲染高度（原 _getCleanScrollMetrics 用
    // offsetHeight）；变更判断则对比已设定的目标值（原 _currentPadding），
    // 避免 0.3s 过渡期间把动画中间值误判为需要更新。
    const offsets = offsetTopsRef.current
    if (offsets.length === 0) return
    const lastOffsetTop = offsets[offsets.length - 1]
    const actualPadding = paddingEl.offsetHeight
    const cleanMaxScrollTop = Math.max(port.scrollHeight - actualPadding - port.clientHeight, 0)
    const needed = Math.ceil(Math.max(0, lastOffsetTop - LAYOUT.ACTIVATE_AHEAD + 20 - cleanMaxScrollTop))
    const currentTarget = Number.parseInt(paddingEl.style.height, 10) || 0
    if (currentTarget !== needed) paddingEl.style.height = `${needed}px`
  }, [])

  // 滚动 / 内容高度变化 / 轴条尺寸变化 → 重算。
  useEffect(() => {
    const port = findScrollContainer()
    if (port === null) return

    let raf = 0
    let paddingTimer: ReturnType<typeof setTimeout> | null = null
    const schedulePadding = (): void => {
      // 原 debouncedUpdateScrollPadding（500ms 防抖）。
      if (paddingTimer !== null) clearTimeout(paddingTimer)
      paddingTimer = setTimeout(() => {
        paddingTimer = null
        updateScrollPadding()
      }, PADDING_DEBOUNCE)
    }
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        recompute()
        updateActive()
        syncTrack()
        updateVirtualRange()
        schedulePadding()
      })
    }

    port.addEventListener('scroll', schedule, { passive: true })
    const track = trackRef.current
    track?.addEventListener('scroll', updateVirtualRange, { passive: true })
    const resizeObserver = new ResizeObserver(schedule)
    const bar = barRef.current
    if (bar !== null) resizeObserver.observe(bar)
    // 流式回复期间消息高度持续变化：观察消息列容器的尺寸。
    const column = document.querySelector('[data-chat-flow]')
    if (column instanceof HTMLElement) resizeObserver.observe(column)

    // 时间轴上滚轮驱动主对话滚动（原 onTimelineWheel，passive: false）。
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      port.scrollTop += e.deltaY
      schedule()
    }
    bar?.addEventListener('wheel', onWheel, { passive: false })

    // ==== 长按圆点切换图钉（原 startLongPress：500ms / 5px / 震动 50ms） ====
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressStart: { x: number; y: number } | null = null

    // 桌面 Safari 等环境不定义 TouchEvent 全局，按属性判断（原版按 e.type 前缀判断）。
    const pointOf = (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      if ('touches' in e) {
        const touch = e.touches[0] as Touch | undefined
        return touch !== undefined ? { x: touch.clientX, y: touch.clientY } : null
      }
      return { x: e.clientX, y: e.clientY }
    }
    const cancelLongPress = (): void => {
      if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null }
      longPressStart = null
    }
    const startLongPress = (e: MouseEvent | TouchEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return
      const dot = target.closest('[data-tl-key]')
      if (!(dot instanceof HTMLElement)) return
      const key = dot.getAttribute('data-tl-key')
      if (key === null) return

      longPressTriggeredRef.current = false
      longPressStart = pointOf(e)
      longPressTimer = setTimeout(() => {
        longPressTimer = null
        const item = itemsRef.current.find(i => i.key === key)
        if (item !== undefined) {
          longPressTriggeredRef.current = true
          navigator.vibrate?.(50)
          onTogglePinRef.current(item)
        }
      }, LONG_PRESS_MS)
    }
    const checkLongPressMove = (e: MouseEvent | TouchEvent): void => {
      if (longPressTimer === null || longPressStart === null) return
      const pos = pointOf(e)
      if (pos === null) return
      const dx = pos.x - longPressStart.x
      const dy = pos.y - longPressStart.y
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_TOLERANCE) cancelLongPress()
    }
    bar?.addEventListener('mousedown', startLongPress)
    bar?.addEventListener('touchstart', startLongPress, { passive: true })
    bar?.addEventListener('mousemove', checkLongPressMove)
    bar?.addEventListener('touchmove', checkLongPressMove, { passive: true })
    bar?.addEventListener('mouseup', cancelLongPress)
    bar?.addEventListener('mouseleave', cancelLongPress)
    bar?.addEventListener('touchend', cancelLongPress)
    bar?.addEventListener('touchcancel', cancelLongPress)

    schedule()
    return () => {
      port.removeEventListener('scroll', schedule)
      track?.removeEventListener('scroll', updateVirtualRange)
      resizeObserver.disconnect()
      bar?.removeEventListener('wheel', onWheel)
      bar?.removeEventListener('mousedown', startLongPress)
      bar?.removeEventListener('touchstart', startLongPress)
      bar?.removeEventListener('mousemove', checkLongPressMove)
      bar?.removeEventListener('touchmove', checkLongPressMove)
      bar?.removeEventListener('mouseup', cancelLongPress)
      bar?.removeEventListener('mouseleave', cancelLongPress)
      bar?.removeEventListener('touchend', cancelLongPress)
      bar?.removeEventListener('touchcancel', cancelLongPress)
      cancelLongPress()
      if (raf !== 0) cancelAnimationFrame(raf)
      if (paddingTimer !== null) clearTimeout(paddingTimer)
      if (pendingActiveTimerRef.current !== null) clearTimeout(pendingActiveTimerRef.current)
    }
  }, [items, recompute, updateActive, syncTrack, updateVirtualRange, updateScrollPadding])

  // 仅在组件卸载时移除注入宿主的 padding 元素（原 destroy 清理）。
  // 不能放在上面的 effect：其依赖含 items，每条新消息都会重跑 cleanup，
  // padding 被删除重建会导致高度从 0 重新过渡、滚动位置跳动。
  useEffect(() => () => {
    document.querySelectorAll(`.${PADDING_CLASS}`).forEach(el => { el.remove() })
  }, [])

  // ==== tooltip 显示/延迟隐藏（TOOLTIP_HIDE_DELAY=100ms，悬停气泡本身保持） ====
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])
  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setHover(null)
    }, LAYOUT.TOOLTIP_HIDE_DELAY)
  }, [cancelHide])
  useEffect(() => cancelHide, [cancelHide])

  const compactClass = geometry.compact ? ` ${css.barCompact}` : ''

  return (
    <>
      <div ref={barRef} className={css.bar + compactClass} aria-label={t('rail.aria')}>
        <div ref={trackRef} className={css.track}>
          <div className={css.trackContent} style={{ height: `${geometry.contentHeight}px` }}>
            {items.map((item, index) => {
              if (index < visibleRange.start || index > visibleRange.end) return null
              const isStarred = starred[item.key] !== undefined
              const isActive = item.key === activeKey
              const n = geometry.dotNs[index] ?? 0
              return (
                <button
                  key={item.key}
                  type="button"
                  className={[
                    css.dot,
                    isActive ? css.dotActive : '',
                    isStarred ? css.dotStarred : '',
                  ].filter(Boolean).join(' ')}
                  style={{ '--n': n } as CSSProperties}
                  data-tl-key={item.key}
                  aria-label={t('dot.aria', { index: index + 1, title: item.title.slice(0, 40) })}
                  aria-current={isActive ? 'true' : undefined}
                  onPointerEnter={(event) => {
                    cancelHide()
                    setHover({ item, anchorRect: event.currentTarget.getBoundingClientRect() })
                  }}
                  onPointerLeave={scheduleHide}
                  onClick={() => {
                    // 长按已切换图钉：吞掉本次点击（原 longPressTriggered 分支）。
                    if (longPressTriggeredRef.current) {
                      longPressTriggeredRef.current = false
                      return
                    }
                    onJump(item.key)
                  }}
                />
              )
            })}
            {/* 图钉标记（原 renderPinMarkers：独立元素、与圆点同法定位） */}
            {items.map((item, index) => (
              index >= visibleRange.start && index <= visibleRange.end && pinned.has(item.key)
                ? (
                  <span
                    key={`pin-${item.key}`}
                    className={css.pinMarker}
                    style={{ '--n': geometry.dotNs[index] ?? 0 } as CSSProperties}
                    aria-hidden
                  />
                )
                : null
            ))}
          </div>
        </div>
      </div>
      {hover !== null
        ? (
          <DotTooltip
            item={hover.item}
            anchorRect={hover.anchorRect}
            isStarred={starred[hover.item.key] !== undefined}
            isPinned={pinned.has(hover.item.key)}
            onToggleStar={() => { onToggleStar(hover.item) }}
            onTogglePin={() => { onTogglePin(hover.item) }}
            onPointerEnter={cancelHide}
            onPointerLeave={scheduleHide}
            t={t}
          />
        )
        : null}
    </>
  )
}
