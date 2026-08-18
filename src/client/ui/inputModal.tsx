/**
 * 全局输入对话框：移植原扩展 GlobalInputModal。
 * 标题 + 单行输入 + 取消/确定，必填与自定义校验（失败时 toast.error 贴输入框），
 * ESC/遮罩取消，自动聚焦 + 光标定位末尾，Promise<string|null> 返回。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Bus } from './bus.ts'
import { toast } from './toast.tsx'
import css from './ui.module.css'

/** 校验结果（原 validator 约定）。 */
export interface InputValidation {
  readonly valid: boolean
  readonly message?: string
}

/** show 配置（与原版对齐；文案未传时由宿主用词典默认值补齐）。 */
export interface InputModalOptions {
  readonly title: string
  readonly defaultValue?: string
  readonly placeholder?: string
  readonly required?: boolean
  readonly requiredMessage?: string
  readonly maxLength?: number
  readonly validator?: (value: string) => InputValidation
  readonly confirmText?: string
  readonly cancelText?: string
}

interface InputModalState extends InputModalOptions {
  readonly resolve: (value: string | null) => void
  readonly closing: boolean
}

const bus = new Bus<InputModalState | null>(null)

function close(value: string | null): void {
  const current = bus.get()
  if (current === null || current.closing) return
  bus.set({ ...current, closing: true })
  current.resolve(value)
  setTimeout(() => {
    if (bus.get()?.closing === true) bus.set(null)
  }, 200)
}

/** 命令式 InputModal API（等价原 window.globalInputModal）。 */
export const inputModal = {
  show(options: InputModalOptions): Promise<string | null> {
    return new Promise((resolve) => {
      if (options.title === '') {
        resolve(null)
        return
      }
      const current = bus.get()
      if (current !== null && !current.closing) {
        // 原版防重复显示：直接返回 null。
        resolve(null)
        return
      }
      bus.set({ ...options, resolve, closing: false })
    })
  },
  forceClose(): void { close(null) },
}

/**
 * InputModal 宿主。
 * portal 到 body：收藏弹窗直挂 body 时，挂在 shell.overlay 里会被挡住。
 * @param props - 词典默认文案 + 宿主主题。
 * @returns 遮罩 + 对话框。
 */
export function InputModalHost({ defaults, dark }: {
  readonly defaults: {
    readonly placeholder: string
    readonly requiredMessage: string
    readonly confirmText: string
    readonly cancelText: string
  }
  readonly dark: boolean
}) {
  const state = useSyncExternalStore(bus.subscribe, () => bus.get())
  const inputRef = useRef<HTMLInputElement>(null)

  // 进入动画：挂载后下一帧再加 visible 类（原版 requestAnimationFrame 遮罩淡入）。
  const active = state !== null && !state.closing
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!active) {
      setEntered(false)
      return
    }
    const raf = requestAnimationFrame(() => { setEntered(true) })
    return () => { cancelAnimationFrame(raf) }
  }, [active])

  // 聚焦 + 光标定位末尾（原 requestAnimationFrame + setSelectionRange）。
  useEffect(() => {
    if (state === null || state.closing) return
    const raf = requestAnimationFrame(() => {
      const input = inputRef.current
      if (input !== null) {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    })
    return () => { cancelAnimationFrame(raf) }
  }, [state !== null && !state.closing])

  if (state === null) return null

  const submit = (): void => {
    const input = inputRef.current
    if (input === null) return
    const value = input.value.trim()
    if (state.required === true && value === '') {
      toast.error(state.requiredMessage ?? defaults.requiredMessage, input)
      return
    }
    if (state.validator !== undefined && value !== '') {
      const validation = state.validator(value)
      if (!validation.valid) {
        toast.error(validation.message ?? '', input)
        return
      }
    }
    close(value !== '' ? value : null)
  }

  return createPortal(
    <div className={css.host} data-theme={dark ? 'dark' : 'light'}>
    <div
      className={!state.closing && entered ? `${css.inputModalOverlay} ${css.inputModalVisible}` : css.inputModalOverlay}
      onClick={(e) => { if (e.target === e.currentTarget) close(null) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close(null)
      }}
    >
      <div className={css.inputModal} role="dialog" aria-modal="true" aria-label={state.title}>
        <div className={css.inputModalHeader}>
          <h3>{state.title}</h3>
        </div>
        <div className={css.inputModalBody}>
          <input
            ref={inputRef}
            type="text"
            className={css.inputModalInput}
            placeholder={state.placeholder ?? defaults.placeholder}
            defaultValue={state.defaultValue ?? ''}
            maxLength={state.maxLength ?? 100}
            autoComplete="off"
          />
        </div>
        <div className={css.inputModalFooter}>
          <button type="button" className={css.inputModalCancel} onClick={() => { close(null) }}>
            {state.cancelText ?? defaults.cancelText}
          </button>
          <button type="button" className={css.inputModalConfirm} onClick={submit}>
            {state.confirmText ?? defaults.confirmText}
          </button>
        </div>
      </div>
    </div>
    </div>,
    document.body,
  )
}
