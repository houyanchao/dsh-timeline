/**
 * 时间轴布局引擎：从原扩展 TimelineManager 逐行移植的纯函数算法。
 * - applyMinGap：最小间距双向修正（前向单调递增 + 越界回推）
 * - computeGeometry：归一化位置 → 轨道像素位置（正常/紧凑两种模式）
 * - computeActiveIndex：按滚动位置计算当前激活节点
 * - easeInOutQuad：平滑滚动缓动
 */
import { preventAutoScroll } from '../shared/preventAutoScroll.ts'

/** 布局常量（与原扩展 variables.css / TIMELINE_CONFIG 相同取值）。 */
export const LAYOUT = {
  /** 轨道上下内边距（--ait-timeline-track-padding）。 */
  TRACK_PADDING: 16,
  /** 正常模式相邻节点最小间距（--timeline-min-gap）。 */
  MIN_GAP: 25,
  /** 紧凑模式默认间距（--timeline-compact-gap）。 */
  COMPACT_GAP: 28,
  /** 提前激活距离：scrollTop >= offsetTop - 120 时激活。 */
  ACTIVATE_AHEAD: 120,
  /** 激活态变更的最小间隔（防抖）。 */
  MIN_ACTIVE_CHANGE_INTERVAL: 120,
  /** tooltip 隐藏延迟。 */
  TOOLTIP_HIDE_DELAY: 100,
  /** 平滑滚动时长。 */
  SCROLL_DURATION: 600,
  /** 点击滚动的顶部偏移。 */
  SCROLL_OFFSET: 30,
  /** 虚拟化渲染的最小缓冲区（VIRTUAL_BUFFER_MIN）。 */
  VIRTUAL_BUFFER_MIN: 100,
} as const

/**
 * 最小间距双向修正：保持单调递增且相邻至少 gap 像素，整体不越界。
 * @param positions - 期望像素位置（升序输入）。
 * @param minTop - 允许的最小位置。
 * @param maxTop - 允许的最大位置。
 * @param gap - 相邻最小间距。
 * @returns 修正后的位置数组。
 */
export function applyMinGap(positions: readonly number[], minTop: number, maxTop: number, gap: number): number[] {
  const n = positions.length
  if (n === 0) return [...positions]
  const out = [...positions]
  out[0] = Math.max(minTop, Math.min(positions[0], maxTop))
  for (let i = 1; i < n; i++) {
    const minAllowed = out[i - 1] + gap
    out[i] = Math.max(positions[i], minAllowed)
  }
  if (out[n - 1] > maxTop) {
    out[n - 1] = maxTop
    for (let i = n - 2; i >= 0; i--) {
      const maxAllowed = out[i + 1] - gap
      out[i] = Math.min(out[i], maxAllowed)
    }
    if (out[0] < minTop) {
      out[0] = minTop
      for (let i = 1; i < n; i++) {
        const minAllowed = out[i - 1] + gap
        out[i] = Math.max(out[i], minAllowed)
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (out[i] < minTop) out[i] = minTop
    if (out[i] > maxTop) out[i] = maxTop
  }
  return out
}

/** 几何计算结果：内容高度、缩放与每个节点的归一化定位值（CSS var --n）。 */
export interface TimelineGeometry {
  readonly contentHeight: number
  readonly compact: boolean
  readonly dotNs: readonly number[]
}

/**
 * 判断是否应使用紧凑模式：平均空间 < 40px 进入、> 45px 退出（滞后区间防抖）。
 * @param barHeight - 时间轴可视高度。
 * @param count - 节点数。
 * @param currentCompact - 当前是否紧凑。
 * @returns 是否紧凑。
 */
export function shouldBeCompact(barHeight: number, count: number, currentCompact: boolean): boolean {
  if (count === 0 || barHeight <= 0) return false
  const avgSpace = barHeight / count
  const threshold = currentCompact ? 45 : 40
  return avgSpace < threshold
}

/**
 * 归一化位置 → 轨道像素位置（移植原版 updateTimelineGeometry）。
 * 正常模式：内容高度 = max(可视高度, 2*pad + (N-1)*minGap)，按 visualN 比例摆放并做 minGap 修正；
 * 紧凑模式：均匀分布、间距自适应、整体垂直居中。
 * @param visualNs - 每个节点的归一化位置（0~1，按消息实际位置比例）。
 * @param barHeight - 时间轴可视高度。
 * @param currentCompact - 当前紧凑状态（滞后判定用）。
 * @returns 几何结果。
 */
export function computeGeometry(
  visualNs: readonly number[],
  barHeight: number,
  currentCompact: boolean,
): TimelineGeometry {
  const N = visualNs.length
  const pad = LAYOUT.TRACK_PADDING
  const H = barHeight
  const compact = shouldBeCompact(H, N, currentCompact)

  let contentHeight: number
  let adjusted: number[]

  if (compact) {
    contentHeight = H
    const defaultGap = LAYOUT.COMPACT_GAP
    const usableH = Math.max(1, H - 2 * pad)
    const requiredHeight = Math.max(0, N - 1) * defaultGap
    const actualGap = (N <= 1)
      ? defaultGap
      : (requiredHeight > usableH) ? (usableH / Math.max(1, N - 1)) : defaultGap
    const totalHeight = Math.max(0, N - 1) * actualGap
    const startY = (H - totalHeight) / 2
    adjusted = visualNs.map((_, i) => startY + i * actualGap)
  } else {
    const minGap = LAYOUT.MIN_GAP
    const desired = Math.max(H, (N > 0 ? (2 * pad + Math.max(0, N - 1) * minGap) : H))
    contentHeight = Math.ceil(desired)
    const usableC = Math.max(1, contentHeight - 2 * pad)
    const desiredY = visualNs.map(n => pad + Math.max(0, Math.min(1, n)) * usableC)
    adjusted = applyMinGap(desiredY, pad, pad + usableC, minGap)
  }

  const usableForN = Math.max(1, contentHeight - 2 * pad)
  const dotNs = adjusted.map((top) => {
    const dn = (top - pad) / usableForN
    return Math.max(0, Math.min(1, dn))
  })
  return { contentHeight, compact, dotNs }
}

/**
 * 按滚动位置计算激活节点索引：最后一个 (offsetTop - ACTIVATE_AHEAD) <= scrollTop 的节点。
 * @param offsetTops - 每个节点在滚动容器内容中的 offsetTop（升序）。
 * @param scrollTop - 滚动容器当前 scrollTop。
 * @returns 激活索引（无节点时 -1）。
 */
export function computeActiveIndex(offsetTops: readonly number[], scrollTop: number): number {
  if (offsetTops.length === 0) return -1
  let active = 0
  for (let i = 0; i < offsetTops.length; i++) {
    if ((offsetTops[i] - LAYOUT.ACTIVATE_AHEAD) <= scrollTop) {
      active = i
    } else {
      break
    }
  }
  return active
}

/**
 * 计算虚拟化可见索引区间（移植原 updateVirtualRangeAndRender 的二分部分）。
 * @param yPositions - 每个节点在轨道内容中的像素 Y（升序）。
 * @param scrollTop - 轨道当前 scrollTop。
 * @param viewportHeight - 轨道可视高度。
 * @returns [start, end]（end 可能为 start-1 表示区间为空）。
 */
export function computeVisibleRange(
  yPositions: readonly number[],
  scrollTop: number,
  viewportHeight: number,
): { start: number; end: number } {
  const buffer = Math.max(LAYOUT.VIRTUAL_BUFFER_MIN, viewportHeight)
  const minY = scrollTop - buffer
  const maxY = scrollTop + viewportHeight + buffer

  // lowerBound：第一个 >= minY 的索引。
  let lo = 0
  let hi = yPositions.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (yPositions[mid] < minY) lo = mid + 1
    else hi = mid
  }
  const start = lo

  // upperBound：最后一个 <= maxY 的索引。
  lo = 0
  hi = yPositions.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (yPositions[mid] <= maxY) lo = mid + 1
    else hi = mid
  }
  const end = Math.max(start - 1, lo - 1)
  return { start, end }
}

/**
 * easeInOutQuad 缓动（原版 smoothScrollTo 使用）。
 * @param t - 已耗时。@param b - 起始值。@param c - 变化量。@param d - 总时长。
 * @returns 当前值。
 */
export function easeInOutQuad(t: number, b: number, c: number, d: number): number {
  t /= d / 2
  if (t < 1) return c / 2 * t * t + b
  t--
  return -c / 2 * (t * (t - 2) - 1) + b
}

/**
 * 平滑滚动到目标元素（移植原版 smoothScrollTo：600ms 缓动 + 30px 顶部偏移 +
 * 每帧重算目标位置以应对流式渲染下的 DOM 高度变化 + 结束后最终修正）。
 * @param scrollContainer - 滚动容器。
 * @param targetElement - 目标消息元素。
 */
export function smoothScrollTo(scrollContainer: HTMLElement, targetElement: HTMLElement): void {
  const duration = LAYOUT.SCROLL_DURATION
  // 声明可信滚动，避免防跳底锚定把插件导航误判为平台自动滚动（原 smoothScrollTo）。
  const navigationId = preventAutoScroll.notifyUserNavigation({ durationMs: duration + 150 })
  const startPosition = scrollContainer.scrollTop

  const getTargetPosition = (): number => {
    const containerRect = scrollContainer.getBoundingClientRect()
    const targetRect = targetElement.getBoundingClientRect()
    return targetRect.top - containerRect.top + scrollContainer.scrollTop - LAYOUT.SCROLL_OFFSET
  }

  let startTime: number | null = null
  const animation = (currentTime: number): void => {
    if (!targetElement.isConnected) return
    if (startTime === null) startTime = currentTime
    const timeElapsed = currentTime - startTime
    const progress = Math.min(timeElapsed / duration, 1)
    const easedProgress = easeInOutQuad(progress, 0, 1, 1)

    const currentTarget = getTargetPosition()
    scrollContainer.scrollTop = startPosition + (currentTarget - startPosition) * easedProgress

    if (progress < 1) {
      requestAnimationFrame(animation)
    } else {
      scrollContainer.scrollTop = getTargetPosition()
      // 导航落点后固化为新的阅读锚点。
      preventAutoScroll.settleUserNavigation({ id: navigationId })
    }
  }
  requestAnimationFrame(animation)
}
