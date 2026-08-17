/**
 * 收藏弹窗：还原原扩展 star-input-modal——居中遮罩 + 标题输入（默认值为
 * 问题摘要、光标定位末尾、100 字上限）+ 文件夹选择器（下拉树 + 各级新建
 * 入口，必选）+ 取消/确定。键盘交互与原版一致：ESC 取消、Ctrl/Cmd+Enter
 * 确认、点击遮罩取消。另导出命令式 starEditModal（收藏树的编辑入口复用）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { Bus } from '../ui/bus.ts'
import { toast } from '../ui/toast.tsx'
import { dropdown } from '../ui/dropdown.tsx'
import { buildFolderSelectItems } from '../starred/actions.tsx'
import { starredStore } from '../starred/storage.ts'
import css from './timeline.module.css'

/** 收藏弹窗结果。 */
export interface StarModalResult {
  readonly value: string
  readonly folderId: string
}

/** 收藏弹窗 props。 */
export interface StarModalProps {
  /** 弹窗标题（收藏="收藏"，树编辑="编辑"）。 */
  readonly title?: string
  /** 默认标题（原版 defaultValue = 问题摘要）。 */
  readonly defaultValue: string
  /** 默认选中的文件夹（编辑场景传入原值）。 */
  readonly defaultFolderId?: string | null
  readonly onConfirm: (result: StarModalResult) => void
  readonly onCancel: () => void
  readonly t: TranslateNS<typeof NS>
}

/** 标题最大长度（原版 defaultMaxLength）。 */
const MAX_LENGTH = 100

/**
 * 收藏弹窗。
 * @param props - 默认标题、默认文件夹与确认/取消回调。
 * @returns fixed 全屏遮罩 + 居中对话框。
 */
export function StarModal({ title, defaultValue, defaultFolderId, onConfirm, onCancel, t }: StarModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const selectorRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId ?? null)
  const [folderPath, setFolderPath] = useState<string>(() => (
    defaultFolderId !== undefined && defaultFolderId !== null
      ? starredStore.getFolderPath(defaultFolderId)
      : ''
  ))

  // 入场动画 + 聚焦并把光标定位到末尾（原版 requestAnimationFrame 逻辑）。
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setVisible(true)
      const input = inputRef.current
      if (input !== null) {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
    })
    return () => { cancelAnimationFrame(raf) }
  }, [])

  const submit = (): void => {
    const value = inputRef.current?.value.trim() ?? ''
    // 校验反馈与原版一致：error toast 锚定输入框（原 submitInput 分支）。
    if (value === '') {
      toast.error(t('starModal.required'), inputRef.current)
      inputRef.current?.focus()
      return
    }
    // 文件夹必选（原版 folderRequired 校验走 toast）。
    if (folderId === null) {
      toast.error(t('starred.folderRequired'), inputRef.current)
      return
    }
    onConfirm({ value: value.slice(0, MAX_LENGTH), folderId })
  }

  // ESC 取消、Ctrl/Cmd+Enter 确认（与原版 handleKeyDown 一致）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (dropdown.isVisible()) return
        onCancel()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && document.activeElement === inputRef.current) {
        e.preventDefault()
        submit()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
    // submit 只依赖 ref 与回调，onCancel/onConfirm 由父层保证稳定语义。
  }, [onCancel, folderId])

  // 点击选择器展开文件夹下拉树（移植 star-input-modal 的菜单构建）。
  const openFolderMenu = (): void => {
    const trigger = selectorRef.current
    if (trigger === null) return
    dropdown.show({
      trigger,
      items: buildFolderSelectItems(t, (id, path) => {
        setFolderId(id)
        setFolderPath(path)
      }),
      position: 'bottom-left',
      width: 200,
    })
  }

  return (
    <div
      className={visible ? `${css.starOverlay} ${css.starOverlayVisible}` : css.starOverlay}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className={css.starModal} role="dialog" aria-modal="true" aria-label={title ?? t('starModal.title')}>
        <div className={css.starModalHeader}>
          <h3>{title ?? t('starModal.title')}</h3>
        </div>
        <div className={css.starModalBody}>
          <div className={css.starModalRow}>
            <label className={css.starModalLabel}>
              {t('starModal.label')}
              <span className={css.starModalRequired}>*</span>
            </label>
            <div className={css.starModalField}>
              <input
                ref={inputRef}
                type="text"
                className={css.starModalInput}
                placeholder={t('starModal.placeholder')}
                maxLength={MAX_LENGTH}
                autoComplete="off"
                defaultValue={defaultValue}
              />
            </div>
          </div>
          <div className={css.starModalRow}>
            <label className={css.starModalLabel}>
              {t('starred.saveTo')}
              <span className={css.starModalRequired}>*</span>
            </label>
            <div
              ref={selectorRef}
              className={css.starModalFolderSelector}
              onClick={(e) => {
                e.stopPropagation()
                openFolderMenu()
              }}
            >
              <span
                className={folderPath === ''
                  ? `${css.starModalFolderText} ${css.starModalFolderTextPlaceholder}`
                  : css.starModalFolderText}
              >
                {folderPath === '' ? t('starred.folderRequired') : folderPath}
              </span>
              <svg className={css.starModalFolderArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </div>
        <div className={css.starModalFooter}>
          <button type="button" className={css.starModalCancel} onClick={onCancel}>
            {t('starModal.cancel')}
          </button>
          <button type="button" className={css.starModalConfirm} onClick={submit}>
            {t('starModal.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==== 命令式收藏编辑弹窗（收藏树"编辑/移动到"复用，等价原 starInputModal） ====

interface StarEditState {
  readonly id: number
  readonly title: string
  readonly defaultValue: string
  readonly defaultFolderId: string | null
  readonly resolve: (r: StarModalResult | null) => void
}

const editBus = new Bus<StarEditState | null>(null)
let editSeq = 0

/** 命令式收藏编辑 API。 */
export const starEditModal = {
  show(options: {
    readonly title: string
    readonly defaultValue: string
    readonly defaultFolderId: string | null
  }): Promise<StarModalResult | null> {
    return new Promise((resolve) => {
      const prev = editBus.get()
      if (prev !== null) prev.resolve(null)
      editSeq += 1
      editBus.set({ id: editSeq, ...options, resolve })
    })
  },
  forceClose(): void {
    const cur = editBus.get()
    if (cur !== null) {
      cur.resolve(null)
      editBus.set(null)
    }
  },
}

/** 收藏编辑弹窗宿主（挂 UiHost；样式随 timeline 根主题容器）。 */
export function StarEditModalHost({ t, dark }: {
  readonly t: TranslateNS<typeof NS>
  readonly dark: boolean
}) {
  const state = useSyncExternalStore(editBus.subscribe, () => editBus.get())
  if (state === null) return null
  const close = (result: StarModalResult | null): void => {
    state.resolve(result)
    editBus.set(null)
  }
  return (
    <div className={css.root} data-dsh-tl-theme={dark ? 'dark' : 'light'}>
      <StarModal
        key={state.id}
        title={state.title}
        defaultValue={state.defaultValue}
        defaultFolderId={state.defaultFolderId}
        onConfirm={(result) => { close(result) }}
        onCancel={() => { close(null) }}
        t={t}
      />
    </div>
  )
}
