/**
 * 全局确认弹窗：移植原扩展 GlobalPopconfirmManager。
 * title + content + 取消/确认双按钮，确认键四种变体（danger 默认/primary/
 * success/default），点击遮罩外部与 ESC 取消，Promise<boolean> 返回。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Bus } from './bus.ts'
import css from './ui.module.css'

/** show 配置（与原版对齐；按钮文案未传时由宿主用词典默认值补齐）。 */
export interface PopconfirmOptions {
  readonly title?: string
  readonly content?: string
  readonly confirmText?: string
  readonly cancelText?: string
  readonly confirmTextType?: 'danger' | 'primary' | 'success' | 'default'
  readonly showCancel?: boolean
}

interface PopconfirmState extends PopconfirmOptions {
  readonly resolve: (result: boolean) => void
  readonly closing: boolean
}

const bus = new Bus<PopconfirmState | null>(null)

function close(result: boolean): void {
  const current = bus.get()
  if (current === null || current.closing) return
  bus.set({ ...current, closing: true })
  current.resolve(result)
  setTimeout(() => {
    if (bus.get()?.closing === true) bus.set(null)
  }, 200)
}

/** 命令式 Popconfirm API（等价原 window.globalPopconfirmManager）。 */
export const popconfirm = {
  show(options: PopconfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const current = bus.get()
      if (current !== null && !current.closing) close(false)
      if ((options.title ?? '') === '' && (options.content ?? '') === '') {
        resolve(false)
        return
      }
      bus.set({ ...options, resolve, closing: false })
    })
  },
  hide(result = false): void { close(result) },
}

/** 确认键变体 → 类名。 */
const CONFIRM_CLASS = {
  danger: css.popconfirmBtnDanger,
  primary: css.popconfirmBtnPrimary,
  success: css.popconfirmBtnSuccess,
  default: css.popconfirmBtnDefault,
} as const

/**
 * Popconfirm 宿主。
 * @param props - 词典默认按钮文案。
 * @returns 遮罩 + 弹窗。
 */
export function PopconfirmHost({ defaultConfirmText, defaultCancelText }: {
  readonly defaultConfirmText: string
  readonly defaultCancelText: string
}) {
  const state = useSyncExternalStore(bus.subscribe, () => bus.get())

  // 进入动画：挂载后下一帧再加 visible 类（原版 requestAnimationFrame 淡入 + scale 弹入）。
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

  // ESC 取消（移植 _handleEscape；原版 100ms 后才挂监听，避免触发点击立即关闭，
  // React 合成事件在下一轮冒泡前不会命中，直接挂即可）。
  useEffect(() => {
    if (state === null || state.closing) return
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
    }
    document.addEventListener('keydown', onKeydown)
    return () => { document.removeEventListener('keydown', onKeydown) }
  }, [state])

  if (state === null) return null

  return (
    <div
      className={!state.closing && entered ? `${css.popconfirmOverlay} ${css.popconfirmVisible}` : css.popconfirmOverlay}
      onClick={(e) => { if (e.target === e.currentTarget) close(false) }}
    >
      <div className={css.popconfirm} role="alertdialog" aria-modal="true">
        <div className={css.popconfirmContent}>
          {(state.title ?? '') !== '' ? <div className={css.popconfirmTitle}>{state.title}</div> : null}
          {(state.content ?? '') !== '' ? <div className={css.popconfirmText}>{state.content}</div> : null}
          <div className={css.popconfirmActions}>
            {state.showCancel !== false
              ? (
                <button
                  type="button"
                  className={`${css.popconfirmBtn} ${css.popconfirmBtnCancel}`}
                  onClick={(e) => { e.stopPropagation(); close(false) }}
                >
                  {state.cancelText ?? defaultCancelText}
                </button>
              )
              : null}
            <button
              type="button"
              className={`${css.popconfirmBtn} ${CONFIRM_CLASS[state.confirmTextType ?? 'danger']}`}
              onClick={(e) => { e.stopPropagation(); close(true) }}
            >
              {state.confirmText ?? defaultConfirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
