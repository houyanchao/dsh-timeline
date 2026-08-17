/**
 * Prevent Auto Scroll On Send（移植原 preventAutoScroll/index.js）。
 *
 * 解决的问题：向上滚动浏览历史时，发送一条新消息后，平台会强制把页面滚动
 * 到底部，并在 AI 生成过程中多次自动滚动到底部，打断当前阅读。
 *
 * 方案：「发送 + 生成期间持续锚定阅读位置」
 *   1. capture 阶段捕获发送动作（回车），早于宿主自身处理。点击发送按钮
 *      无稳定选择器，且普通消息发送不经过 InputState.phase 提交态（宿主
 *      状态机对非斜杠草稿直接走 default-sink，phase 恒为 plain），因此
 *      点击发送以「草稿 COMMIT 清空」（send-committed）为确认信号：
 *      capture 阶段 pointerdown 先记录发送前滚动位置快照（早于宿主处理），
 *      草稿从非空变空时用快照启动锚定；斜杠命令仍由 phase 提交态通知。
 *   2. 仅当发送前用户已向上滚动、不在底部时才介入；已在底部则不干预。
 *   3. 用 rAF 循环把 scrollTop 钉回 savedTop，抵消宿主的自动滚动；
 *      锚定持续到 AI 生成结束（依据 chat.running，由 React 侧喂入）。
 *   4. 生成期间用户主动滚动时不放弃保护，而是「跟随」用户更新 savedTop：
 *      wheel 事件的 deltaY 累计为「用户滚动预算」，每帧位移在预算内视为
 *      用户滚动予以跟随，超出预算视为程序化大跳予以拒绝（原 issue #129）。
 *
 * 时间轴等插件内导航通过 notifyUserNavigation/settleUserNavigation 声明
 * 可信滚动，避免锚定逻辑把插件主动跳转误判为平台自动滚动。
 */
import { useEffect, useRef } from 'react'
import { settingsStore } from './settings.ts'

/** 发送后等待生成开始的宽限期（ms）。 */
const START_GRACE = 2000
/** 生成结束后继续锚定一小段，拦截收尾时的自动滚动（ms）。 */
const TAIL_AFTER = 600
/** 安全上限，防止生成态检测异常导致无限锚定（ms）。 */
const MAX_DURATION = 120000
/** 距底部多少 px 内视为「已在底部」。 */
const BOTTOM_THRESHOLD = 150
/** 用户主动滚动后的「跟随」窗口（ms）。 */
const USER_WINDOW = 250
/** 跟随窗口内，无预算时单帧位移 <= 此值视为用户滚动。 */
const USER_STEP_MAX = 400
/** 用户滚动预算上限（px），防止累计预算过大放行平台跳转。 */
const USER_BUDGET_MAX = 6000
/** 窗口过期后预算的存活期（ms），覆盖卡顿时滚动位移延迟到达。 */
const BUDGET_TTL = 300
/** pointerdown 位置快照的有效期（ms）：点击发送到草稿清空的最大间隔。 */
const CLICK_SNAPSHOT_TTL = 800
/** 锚定期间按下即视为用户想自己滚动的导航键。 */
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])

/** DSH composer 的 textarea（与智能回车共用选择器）。 */
const INPUT_SELECTOR = '[data-input-scroll] textarea'
/** DSH 会话滚动容器（时间轴同款选择器）。 */
const SCROLL_SELECTOR = '[data-conversation-scroll]'

/** notifyUserNavigation 的可选参数。 */
export interface NavigationOptions {
  /** 可信跟随时长（默认 USER_WINDOW）。 */
  readonly durationMs?: number
}

/** 锚定容器：DSH 会话滚动容器或 window 兜底。 */
type ScrollHost = HTMLElement | Window

class ScrollAnchor {
  private pinning = false
  private scrollContainer: ScrollHost | null = null
  private savedTop = 0
  private rafId: number | null = null
  private startTs = 0
  private sawGenerating = false
  private lastGeneratingTs = 0
  private userScrollUntil = 0
  private pendingUserDelta = 0
  private lastTouchY: number | null = null
  private trustedNavigationUntil = 0
  private trustedNavigationId = 0
  /** 生成态（React 侧经 setGenerating 喂入 chat.running）。 */
  private generating = false
  /** pointerdown 时的滚动位置快照（点击发送的「发送前」位置，早于宿主滚底）。 */
  private clickSnapshot: { top: number; atBottom: boolean; ts: number } | null = null

  private readonly onKeydown = (e: KeyboardEvent): void => {
    // 锚定期间按下导航键 => 用户想自己滚动，开启跟随窗口。
    if (this.pinning && NAV_KEYS.has(e.key)) {
      this.userScrollUntil = performance.now() + USER_WINDOW
      return
    }

    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return

    const target = e.target
    if (!(target instanceof Element)) return
    const editor = target.closest(INPUT_SELECTOR)
    if (editor === null) return

    // 输入框为空（占位态）不会发送，跳过。
    if (!(editor instanceof HTMLTextAreaElement) || editor.value.trim().length === 0) return

    this.maybeStartPin()
  }

  private readonly onPointerDown = (): void => {
    // 锚定中无需快照（Enter/斜杠命令路径已取位，草稿清空通知只会 no-op）。
    if (this.pinning) return
    if (!settingsStore.get().preventAutoScrollEnabled) return
    const container = this.findScrollContainer()
    const { top, atBottom } = this.measure(container)
    this.clickSnapshot = { top, atBottom, ts: performance.now() }
  }

  private readonly onUserScrollIntent = (e: WheelEvent | TouchEvent): void => {
    if (!this.pinning) return

    // 边界处（到顶/到底）滚轮不会产生实际位移，必须在刷新跟随窗口前跳过，
    // 避免无效手势延长已有预算的存活时间。
    if (e.type === 'wheel' && !this.canScrollInDirection((e as WheelEvent).deltaY)) return

    const now = performance.now()
    const gestureExpired = now >= this.userScrollUntil
    this.userScrollUntil = now + USER_WINDOW

    // 把手势的实际位移累计为「用户滚动预算」，供 loop 按量放行。
    // 只靠固定的单帧阈值判断，在长对话掉帧时会把用户滚动误判为程序化大跳。
    if (e.type === 'wheel') {
      const wheel = e as WheelEvent
      let dy = Math.abs(wheel.deltaY)
      if (wheel.deltaMode === 1) dy *= 16 // 行 -> px
      else if (wheel.deltaMode === 2) dy *= window.innerHeight // 页 -> px
      this.pendingUserDelta = Math.min(USER_BUDGET_MAX, this.pendingUserDelta + dy)
    } else if (e.type === 'touchmove') {
      const touch = (e as TouchEvent).touches[0]
      const y = touch !== undefined ? touch.clientY : null
      if (y !== null) {
        // 窗口已过期视为新手势，只重置基准点不累计位移。
        if (!gestureExpired && this.lastTouchY !== null) {
          this.pendingUserDelta = Math.min(
            USER_BUDGET_MAX,
            this.pendingUserDelta + Math.abs(y - this.lastTouchY),
          )
        }
        this.lastTouchY = y
      }
    }
  }

  private readonly loop = (): void => {
    if (!this.pinning || this.scrollContainer === null) return

    const now = performance.now()
    const cur = this.readTop(this.scrollContainer)

    // 先清除已过期预算再判断位移，避免在存活期外仍放行一次平台自动滚动。
    if (this.pendingUserDelta > 0 && now >= this.userScrollUntil + BUDGET_TTL) {
      this.pendingUserDelta = 0
    }

    if (now < this.trustedNavigationUntil) {
      // 插件主动导航：可信任大位移，持续跟随并更新锚点。
      this.savedTop = cur
    } else if (now < this.userScrollUntil || this.pendingUserDelta > 0) {
      // 用户滚动窗口内（或掉帧导致窗口已过期但仍有未消费的滚动预算）：
      // 单帧位移在「基础阈值 + 预算」内视为用户滚动，跟随并消费预算；
      // 超出则视为平台的程序化大跳，钉回锚点。
      const step = Math.abs(cur - this.savedTop)
      if (step <= USER_STEP_MAX + this.pendingUserDelta) {
        this.pendingUserDelta = Math.max(0, this.pendingUserDelta - step)
        this.savedTop = cur // 跟随
      } else {
        this.setTop(this.scrollContainer, this.savedTop) // 拒绝平台的大跳
      }
    } else {
      // 非用户滚动：把位置钉回 savedTop，抵消平台的自动滚动。
      this.setTop(this.scrollContainer, this.savedTop)
    }

    const elapsed = now - this.startTs
    if (this.generating) {
      this.sawGenerating = true
      this.lastGeneratingTs = now
    }

    let cont: boolean
    if (elapsed >= MAX_DURATION) {
      cont = false
    } else if (this.sawGenerating) {
      // 生成中持续锚定；生成结束后再多守 TAIL_AFTER 拦截收尾滚动。
      cont = this.generating || (now - this.lastGeneratingTs) < TAIL_AFTER
    } else {
      // 生成尚未开始，在宽限期内等待。
      cont = elapsed < START_GRACE
    }

    if (cont) {
      this.rafId = requestAnimationFrame(this.loop)
    } else {
      this.stopPin()
    }
  }

  private listening = false
  /** 挂载引用计数：多个槽位实例共存时，最后一个卸载才真正拆监听。 */
  private mounts = 0

  /** 挂载全局监听（capture 阶段发送捕获 + 位置快照 + 用户滚动意图）。 */
  init(): void {
    this.mounts += 1
    if (this.listening) return
    this.listening = true
    document.addEventListener('keydown', this.onKeydown, true)
    document.addEventListener('pointerdown', this.onPointerDown, true)
    window.addEventListener('wheel', this.onUserScrollIntent, { passive: true, capture: true })
    window.addEventListener('touchmove', this.onUserScrollIntent, { passive: true, capture: true })
  }

  destroy(): void {
    this.mounts = Math.max(0, this.mounts - 1)
    if (this.mounts > 0) return
    this.stopPin()
    document.removeEventListener('keydown', this.onKeydown, true)
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    window.removeEventListener('wheel', this.onUserScrollIntent, { capture: true })
    window.removeEventListener('touchmove', this.onUserScrollIntent, { capture: true })
    this.listening = false
  }

  /** React 侧喂入生成态（chat.running）。 */
  setGenerating(generating: boolean): void {
    this.generating = generating
  }

  /** 发送意图（InputState.phase 进入提交态时由 React 侧调用，对应原 _onClick）。 */
  notifySendIntent(): void {
    // 生成中触发的是「停止」，不处理（对齐原 _onClick 的 isGenerating 分支）。
    if (this.generating) return
    this.maybeStartPin()
  }

  /**
   * 发送已提交（草稿被 COMMIT 清空时由 React 侧调用）。
   * 覆盖点击发送按钮发送普通消息：该路径不产生 Enter keydown，
   * phase 也恒为 plain，草稿清空是唯一可观测的稳定信号。
   * 通知到达时宿主可能已滚底，故优先用 pointerdown 快照里的「发送前」位置。
   */
  notifySendCommitted(): void {
    // Enter/斜杠命令路径已先行锚定，勿用当前（可能已滚底的）位置覆盖锚点。
    if (this.pinning) return

    const snap = this.clickSnapshot
    this.clickSnapshot = null
    if (snap !== null && performance.now() - snap.ts <= CLICK_SNAPSHOT_TTL) {
      if (snap.atBottom) return
      if (!settingsStore.get().preventAutoScrollEnabled) return
      this.startPinAt(snap.top)
      return
    }
    // 无新鲜快照（非点击触达的发送）：按当前位置兜底。
    this.maybeStartPin()
  }

  /**
   * 插件内主动导航（时间轴节点、问题列表等）可大幅改变 scrollTop，
   * 不适用 USER_STEP_MAX 的用户手势阈值。
   * @param options - 可信跟随时长。
   * @returns navigation id，供 settleUserNavigation 校验。
   */
  notifyUserNavigation(options: NavigationOptions = {}): number | undefined {
    if (!this.pinning || this.scrollContainer === null) return undefined

    const durationMs = options.durationMs
    const followMs = durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : USER_WINDOW

    this.trustedNavigationId += 1
    this.trustedNavigationUntil = performance.now() + followMs
    this.savedTop = this.readTop(this.scrollContainer)
    return this.trustedNavigationId
  }

  /**
   * 插件内导航落点后，将当前位置固化为新的阅读锚点。
   * @param options - notifyUserNavigation 返回的 id（不匹配则忽略）。
   */
  settleUserNavigation(options: { readonly id?: number } = {}): void {
    if (!this.pinning || this.scrollContainer === null) return
    if (options.id !== undefined && options.id !== this.trustedNavigationId) return

    this.savedTop = this.readTop(this.scrollContainer)
    this.trustedNavigationUntil = 0
  }

  /** 设置开关关闭时立即解除当前锚定（原 loadSetting 的 onChanged 分支）。 */
  stopPin(): void {
    this.pinning = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.scrollContainer = null
    this.pendingUserDelta = 0
    this.lastTouchY = null
    this.trustedNavigationUntil = 0
    this.trustedNavigationId = 0
  }

  // ==================== 锚定逻辑 ====================

  private maybeStartPin(): void {
    if (!settingsStore.get().preventAutoScrollEnabled) return

    const container = this.findScrollContainer()
    const { top, atBottom } = this.measure(container)

    // 已在底部 => 让平台正常滚动，不干预。
    if (atBottom) return

    this.startPinAt(top)
  }

  /** 以给定阅读位置为锚点启动（或重置）锚定循环。 */
  private startPinAt(top: number): void {
    this.scrollContainer = this.findScrollContainer()
    this.savedTop = top
    this.startTs = performance.now()
    this.sawGenerating = false
    this.lastGeneratingTs = 0
    this.userScrollUntil = 0
    this.pendingUserDelta = 0
    this.lastTouchY = null
    this.trustedNavigationUntil = 0
    this.trustedNavigationId = 0

    if (!this.pinning) {
      this.pinning = true
      this.rafId = requestAnimationFrame(this.loop)
    }
  }

  // ==================== 滚动容器工具 ====================

  /** 会话滚动容器（DSH 稳定选择器），回退到 window。 */
  private findScrollContainer(): ScrollHost {
    const el = document.querySelector(SCROLL_SELECTOR)
    return el instanceof HTMLElement ? el : window
  }

  private readTop(container: ScrollHost): number {
    if (container instanceof Window) return container.scrollY
    return container.scrollTop
  }

  /** 容器在手势方向上是否还有可滚动空间（deltaY > 0 向下）。 */
  private canScrollInDirection(deltaY: number): boolean {
    const container = this.scrollContainer
    if (container === null || deltaY === 0) return false
    const top = this.readTop(container)
    if (deltaY < 0) return top > 1
    const maxTop = container instanceof Window
      ? document.documentElement.scrollHeight - window.innerHeight
      : container.scrollHeight - container.clientHeight
    return top < maxTop - 1
  }

  private measure(container: ScrollHost): { top: number; atBottom: boolean } {
    if (container instanceof Window) {
      const top = container.scrollY
      const clientHeight = window.innerHeight
      const scrollHeight = document.documentElement.scrollHeight
      return { top, atBottom: scrollHeight - clientHeight - top < BOTTOM_THRESHOLD }
    }
    const top = container.scrollTop
    return {
      top,
      atBottom: container.scrollHeight - container.clientHeight - top < BOTTOM_THRESHOLD,
    }
  }

  private setTop(container: ScrollHost, top: number): void {
    if (container instanceof Window) {
      container.scrollTo(0, top)
    } else {
      container.scrollTop = top
    }
  }
}

/** 模块单例（原 window.__aitPreventAutoScroll 的 DSH 形态）。 */
export const preventAutoScroll = new ScrollAnchor()

/**
 * 挂载 hook：composer 槽位组件调用。
 * - 挂载/卸载全局监听；
 * - 喂入生成态（chat.running）；
 * - 监听 InputState.phase 跃迁到提交态触发锚定（斜杠命令发送路径）；
 * - 监听草稿从非空 COMMIT 清空触发锚定（普通消息发送路径，含点击发送按钮）；
 * - 开关关闭时立即解除锚定。
 * @param running - 当前会话 chat.running。
 * @param phase - 当前 InputState.phase。
 * @param draft - 当前 InputState.draft。
 */
export function usePreventAutoScroll(running: boolean, phase: string, draft: string): void {
  useEffect(() => {
    preventAutoScroll.init()
    return () => { preventAutoScroll.destroy() }
  }, [])

  useEffect(() => {
    preventAutoScroll.setGenerating(running)
  }, [running])

  // phase 跃迁到提交态 => 斜杠命令发送（普通消息 phase 恒为 plain，
  // 走下方草稿清空分支）。以 prev 比较跳过挂载时的初始值，避免组件在
  // 提交中途重挂载时误触发。Enter 场景 keydown 已先行锚定，
  // maybeStartPin 重入只是刷新锚点，仍早于宿主滚动。
  const prevPhase = useRef(phase)
  useEffect(() => {
    const prev = prevPhase.current
    prevPhase.current = phase
    if (phase === prev) return
    if (phase === 'adjudicating' || phase === 'submitting') {
      preventAutoScroll.notifySendIntent()
    }
  }, [phase])

  // 草稿从非空变空 => 普通消息发送被接受（send-committed 以 COMMIT 清空草稿）。
  // 点击发送按钮的普通消息不产生 Enter keydown 也不改 phase，靠此信号锚定。
  const prevDraft = useRef(draft)
  useEffect(() => {
    const prev = prevDraft.current
    prevDraft.current = draft
    if (draft === '' && prev.trim() !== '') {
      preventAutoScroll.notifySendCommitted()
    }
  }, [draft])

  // 开关关闭时立即解除当前锚定（原 chrome.storage.onChanged 分支）。
  useEffect(() => settingsStore.subscribe(() => {
    if (!settingsStore.get().preventAutoScrollEnabled) preventAutoScroll.stopPin()
  }), [])
}
