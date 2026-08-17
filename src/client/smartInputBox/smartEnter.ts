/**
 * 智能回车：移植原 SmartEnterManager 的按键接管逻辑。
 * 三种模式：双击 Enter 发送 / Ctrl(⌘)+Enter 发送 / Shift+Enter 发送，
 * 皆为「Enter 换行」+ 指定组合键发送。
 * 通过 capture 阶段拦截 DSH composer textarea 的 keydown，
 * 换行走原生 value setter + input 事件（触发 React onChange），
 * 发送则重放一个合成 Enter 事件放行给宿主自身的提交逻辑。
 */
import { useEffect } from 'react'
import { settingsStore, type SmartEnterMode } from '../shared/settings.ts'
import { toast } from '../ui/toast.tsx'

/** 双击 Enter 判定间隔（原 SMART_ENTER_CONFIG.DOUBLE_CLICK_INTERVAL）。 */
const DOUBLE_CLICK_INTERVAL = 300
/** DOM 变化防抖（原 SMART_ENTER_CONFIG.DEBOUNCE_DELAY）。 */
const DEBOUNCE_DELAY = 200
/** 健康检查周期（原 _startHealthCheck 的 5000ms）。 */
const HEALTH_CHECK_INTERVAL = 5000
/** 换行提示 toast 的最大展示次数（原 _showNewlineToast 的 count >= 5）。 */
const TOAST_MAX_COUNT = 5

/** 换行提示 toast 配色（原 _showNewlineToast 的 color；黑底改取宿主 tooltip 底板 token）。 */
const NEWLINE_TOAST_COLOR = {
  light: { backgroundColor: 'var(--dsw-alias-tooltip-bg)', textColor: '#ffffff', borderColor: 'var(--dsw-alias-tooltip-bg)' },
  dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
}

/** DSH composer 的 textarea（宿主 InputBar 的输入元素）。 */
const INPUT_SELECTOR = '[data-input-scroll] textarea'

/** 换行/发送提示文案的翻译函数形态。 */
type ToastText = (mode: SmartEnterMode) => string

/** React 受控 textarea 的原生赋值（绕过 React 的 value 劫持，再派发 input）。 */
function setNativeValue(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter === undefined) return
  setter.call(el, value)
}

class SmartEnterManager {
  private readonly getToastText: ToastText

  /** 状态（原 this.state）。 */
  private lastEnterTime = 0
  private enterCount = 0
  private savedSelection: { start: number; end: number } | null = null
  private allowNextEnter = false

  private newlineTimer: ReturnType<typeof setTimeout> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private observer: MutationObserver | null = null

  /** 已附加元素及其处理器（原 attachedElements WeakMap）。 */
  private readonly attached = new WeakMap<HTMLTextAreaElement, {
    keydown: (e: KeyboardEvent) => void
    input: () => void
  }>()

  constructor(getToastText: ToastText) {
    this.getToastText = getToastText
  }

  init(): void {
    this.attachIfNeeded()
    // DOM 监听（原 _startObserving：body 子树变化防抖后重试附加）。
    this.observer = new MutationObserver((mutations) => {
      if (!mutations.some(m => m.addedNodes.length > 0)) return
      if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        this.attachIfNeeded()
      }, DEBOUNCE_DELAY)
    })
    this.observer.observe(document.body, { childList: true, subtree: true })
    // 健康检查（原 _startHealthCheck：兜底重绑新生成的输入框）。
    this.healthCheckInterval = setInterval(() => { this.attachIfNeeded() }, HEALTH_CHECK_INTERVAL)
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.healthCheckInterval !== null) { clearInterval(this.healthCheckInterval); this.healthCheckInterval = null }
    const input = document.querySelector<HTMLTextAreaElement>(INPUT_SELECTOR)
    if (input !== null) this.detachListener(input)
    this.resetState()
  }

  private attachIfNeeded(): void {
    const input = document.querySelector<HTMLTextAreaElement>(INPUT_SELECTOR)
    if (input !== null && !this.attached.has(input)) this.attachListener(input)
  }

  private attachListener(input: HTMLTextAreaElement): void {
    const keydown = (e: KeyboardEvent): void => { this.handleKeyDown(input, e) }
    const inputHandler = (): void => { this.handleInput() }
    input.addEventListener('keydown', keydown, { capture: true })
    input.addEventListener('input', inputHandler)
    this.attached.set(input, { keydown, input: inputHandler })
  }

  private detachListener(input: HTMLTextAreaElement): void {
    const handlers = this.attached.get(input)
    if (handlers === undefined) return
    input.removeEventListener('keydown', handlers.keydown, { capture: true })
    input.removeEventListener('input', handlers.input)
    this.attached.delete(input)
  }

  /** input 事件：监听窗口期内内容变化则取消当前 Enter 处理（原 _handleInput）。 */
  private handleInput(): void {
    if (this.newlineTimer !== null) {
      clearTimeout(this.newlineTimer)
      this.newlineTimer = null
      this.resetState()
    }
  }

  private handleKeyDown(input: HTMLTextAreaElement, e: KeyboardEvent): void {
    if (e.key !== 'Enter') return
    // 我们重放的合成 Enter（用于发送）放行。
    if (this.allowNextEnter) return

    const settings = settingsStore.get()
    if (!settings.smartEnterEnabled) return

    const mode = settings.smartEnterMode
    if (mode === 'doubleEnter') this.handleDoubleEnterMode(input, e)
    else if (mode === 'ctrlEnter') this.handleCtrlEnterMode(input, e)
    else this.handleShiftEnterMode(input, e)
  }

  /** 模式1：快速双击 Enter 发送（原 _handleDoubleEnterMode）。 */
  private handleDoubleEnterMode(input: HTMLTextAreaElement, e: KeyboardEvent): void {
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return

    e.preventDefault()
    e.stopPropagation()

    const now = Date.now()
    const timeSinceLastEnter = now - this.lastEnterTime

    if (this.enterCount > 0 && timeSinceLastEnter < DOUBLE_CLICK_INTERVAL) {
      this.enterCount += 1
      if (this.enterCount >= 2) {
        if (this.newlineTimer !== null) { clearTimeout(this.newlineTimer); this.newlineTimer = null }
        this.triggerSend(input)
        this.resetState()
      }
    } else {
      if (this.newlineTimer !== null) { clearTimeout(this.newlineTimer); this.newlineTimer = null }

      this.savedSelection = { start: input.selectionStart, end: input.selectionEnd }
      this.enterCount = 1
      this.lastEnterTime = now

      this.newlineTimer = setTimeout(() => {
        this.newlineTimer = null
        if (this.enterCount === 1 && this.canSend(input)) {
          this.insertNewlineAtSavedPosition(input)
        }
        this.resetState()
      }, DOUBLE_CLICK_INTERVAL)
    }
  }

  /** 模式2：Enter 即时换行，Ctrl/Cmd+Enter 发送（原 _handleCtrlEnterMode）。 */
  private handleCtrlEnterMode(input: HTMLTextAreaElement, e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      this.triggerSend(input)
    } else if (!e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      this.insertNewline(input)
      this.showNewlineToast(input)
    }
  }

  /** 模式3：Enter 即时换行，Shift+Enter 发送（原 _handleShiftEnterMode）。 */
  private handleShiftEnterMode(input: HTMLTextAreaElement, e: KeyboardEvent): void {
    if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      this.triggerSend(input)
    } else if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      this.insertNewline(input)
      this.showNewlineToast(input)
    }
  }

  /** 在保存的位置插入换行（原 _insertNewlineAtSavedPosition）。 */
  private insertNewlineAtSavedPosition(input: HTMLTextAreaElement): void {
    if (this.savedSelection !== null) {
      input.selectionStart = this.savedSelection.start
      input.selectionEnd = this.savedSelection.end
    }
    this.insertNewline(input)
    this.showNewlineToast(input)
  }

  /** 插入换行符（原 _insertNewline 的 textarea 分支，改用原生 setter 兼容受控组件）。 */
  private insertNewline(input: HTMLTextAreaElement): void {
    const start = input.selectionStart
    const end = input.selectionEnd
    const value = input.value

    setNativeValue(input, `${value.substring(0, start)}\n${value.substring(end)}`)
    const newPosition = start + 1
    input.selectionStart = newPosition
    input.selectionEnd = newPosition

    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** 换行提示 toast，最多提示 5 次（原 _showNewlineToast）。 */
  private showNewlineToast(input: HTMLTextAreaElement): void {
    const settings = settingsStore.get()
    if (settings.smartEnterToastCount >= TOAST_MAX_COUNT) return

    const message = this.getToastText(settings.smartEnterMode)
    toast.info(message, input, {
      duration: 2500,
      icon: '',
      color: NEWLINE_TOAST_COLOR,
    })
    settingsStore.set({ smartEnterToastCount: settings.smartEnterToastCount + 1 })
  }

  /** 输入框非空才允许发送（原 adapter.canSend）。 */
  private canSend(input: HTMLTextAreaElement): boolean {
    return input.value.trim().length > 0
  }

  /** 触发发送：重放合成 Enter 让宿主原生处理（原 _triggerSend）。 */
  private triggerSend(input: HTMLTextAreaElement): void {
    if (!this.canSend(input)) return

    if (document.activeElement !== input) input.focus()

    this.allowNextEnter = true
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }))
    setTimeout(() => { this.allowNextEnter = false }, 50)
  }

  private resetState(): void {
    this.lastEnterTime = 0
    this.enterCount = 0
    this.savedSelection = null
    this.allowNextEnter = false
    if (this.newlineTimer !== null) { clearTimeout(this.newlineTimer); this.newlineTimer = null }
    if (this.debounceTimer !== null) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
  }
}

/** 智能回车挂载 hook：composer 槽位组件调用（随会话生命周期附加/清理）。 */
export function useSmartEnter(getToastText: ToastText): void {
  useEffect(() => {
    const manager = new SmartEnterManager(getToastText)
    manager.init()
    return () => { manager.destroy() }
    // getToastText 仅读词典，变化不需要重建管理器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
