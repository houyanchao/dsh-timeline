/**
 * 文件夹编辑弹窗：移植原扩展 sidebarStarred/folder-edit-modal（新建/编辑
 * 文件夹，emoji 图标选择器 + 名称输入 + 校验）。命令式 API，Promise 返回
 * `{ name, icon }` 或 null（取消）。
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Bus } from '../ui/bus.ts'
import { toast } from '../ui/toast.tsx'
import css from './starred.module.css'

/** 图标分类（逐项移植原 iconCategories）。 */
const ICON_CATEGORIES = [
  {
    id: 'emoji',
    label: '表情',
    icons: [
      '', '😀', '😊', '😎', '🤓', '🤔', '😍', '🥰',
      '🤩', '😇', '🥳', '😏', '😌', '🤗', '😬', '🫡',
      '🧐', '😴', '🥱', '😷', '🤒', '🥺', '😢', '😤',
      '😡', '🤯', '😱', '😂', '🤣', '🥹', '😈', '🤖',
      '👻', '👽', '💀', '🤡', '😺', '😸', '😻', '😼',
    ],
  },
  {
    id: 'symbol',
    label: '符号',
    icons: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '⭐', '🌟', '✨', '💫', '🔥', '💥', '💯', '💢',
      '✅', '❌', '⭕', '❗', '❓', '⚠️', '🚫', '⛔',
      '♻️', '💠', '🔷', '🔶', '🔴', '🟠', '🟡', '🟢',
      '🔵', '🟣', '⚫', '⚪', '🟤', '▶️', '⏸️', '🔔',
    ],
  },
  {
    id: 'letter',
    label: 'ABC',
    icons: [
      '🅰️', '🅱️', '🆎', '🅾️', '🅿️', 'Ⓜ️', 'ℹ️', '🆑',
      '🆒', '🆓', '🆔', '🆕', '🆖', '🆗', '🆘', '🆙',
      '🆚', '©️', '®️', '™️', '‼️', '⁉️', '🔤', '🔠',
      '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣',
      '8️⃣', '9️⃣', '🔟', '#️⃣', '*️⃣', '🔢', '🔡', '🔣',
    ],
  },
  {
    id: 'object',
    label: '物品',
    icons: [
      '📁', '📂', '📌', '📎', '🔖', '🏷️', '🗂️', '📋',
      '📝', '✏️', '📚', '📖', '📓', '📒', '📕', '📗',
      '💼', '🎒', '📦', '🔑', '🔒', '🔓', '💡', '🔧',
      '⚙️', '🛠️', '🔬', '💻', '📱', '⌨️', '🖥️', '📷',
      '🎵', '🎬', '📊', '📈', '💰', '💎', '🎁', '🧩',
    ],
  },
  {
    id: 'nature',
    label: '自然',
    icons: [
      '☀️', '🌙', '⭐', '🌈', '🌊', '🔥', '❄️', '⚡',
      '💧', '🌍', '🌏', '🌎', '🌸', '🌺', '🌻', '🌹',
      '🌷', '🍀', '🌿', '🌱', '🌲', '🌴', '🍁', '🍂',
      '🍄', '🌵', '💎', '🪨', '🪵', '🌋', '🏔️', '🪐',
      '☄️', '🌕', '🌑', '🌓', '🌗', '☁️', '⛅', '🌪️',
    ],
  },
  {
    id: 'animal',
    label: '动物',
    icons: [
      '🐶', '🐱', '🐻', '🦊', '🐼', '🐨', '🦁', '🐯',
      '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦅',
      '🦉', '🐝', '🦋', '🐌', '🐞', '🐢', '🐍', '🐙',
      '🐬', '🐳', '🦈', '🐠', '🦀', '🦄', '🐺', '🐿️',
      '🦔', '🦩', '🦜', '🐾', '🦎', '🐡', '🐰', '🐹',
    ],
  },
  {
    id: 'food',
    label: '食物',
    icons: [
      '🍎', '🍊', '🍋', '🍇', '🍓', '🍑', '🍒', '🥝',
      '🍌', '🍉', '🥭', '🍍', '🥥', '🥑', '🌽', '🥕',
      '🍕', '🍔', '🌮', '🍜', '🍣', '🍱', '🥗', '🍝',
      '🍩', '🍰', '🧁', '🍫', '🍪', '🍿', '🧀', '🥐',
      '☕', '🍵', '🥤', '🍺', '🍷', '🧃', '🥛', '🍶',
    ],
  },
] as const

/** 弹窗配置（等价原 show(options)）。 */
export interface FolderEditOptions {
  readonly title: string
  readonly confirmText: string
  readonly cancelText: string
  readonly placeholder: string
  readonly defaultName?: string
  readonly defaultIcon?: string
  readonly maxLength?: number
  /** 返回错误文案则阻止提交（原 validate + toast.error）。 */
  readonly validate?: (name: string) => string | null
  /** 名称为空时的提示。 */
  readonly emptyMessage: string
}

export interface FolderEditResult {
  readonly name: string
  readonly icon: string
}

interface ModalState {
  readonly id: number
  readonly options: FolderEditOptions
  readonly resolve: (r: FolderEditResult | null) => void
}

const bus = new Bus<ModalState | null>(null)
let seq = 0

/** 文件夹编辑弹窗命令式 API。 */
export const folderEditModal = {
  show(options: FolderEditOptions): Promise<FolderEditResult | null> {
    return new Promise((resolve) => {
      const prev = bus.get()
      if (prev !== null) prev.resolve(null)
      seq += 1
      bus.set({ id: seq, options, resolve })
    })
  },
  forceClose(): void {
    const cur = bus.get()
    if (cur !== null) {
      cur.resolve(null)
      bus.set(null)
    }
  },
}

/** 单个弹窗实例（keyed by id，保证状态随会话重置）。 */
function ModalInstance({ state }: { readonly state: ModalState }) {
  const { options } = state
  const [name, setName] = useState(options.defaultName ?? '')
  const [icon, setIcon] = useState(options.defaultIcon ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tab, setTab] = useState<string>(ICON_CATEGORIES[0].id)
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const iconBtnRef = useRef<HTMLButtonElement>(null)

  // 进场动画 + 自动聚焦（原 requestAnimationFrame + focus/setSelectionRange）。
  useEffect(() => {
    const raf = requestAnimationFrame(() => { setVisible(true) })
    const input = inputRef.current
    if (input !== null) {
      input.focus()
      const len = input.value.length
      input.setSelectionRange(len, len)
    }
    return () => { cancelAnimationFrame(raf) }
  }, [])

  // 点击图标选择器外部关闭（原 document click 捕获）。
  useEffect(() => {
    if (!pickerOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (pickerRef.current?.contains(target) === true) return
      if (iconBtnRef.current?.contains(target) === true) return
      setPickerOpen(false)
    }
    document.addEventListener('click', onDocClick, true)
    return () => { document.removeEventListener('click', onDocClick, true) }
  }, [pickerOpen])

  const close = (result: FolderEditResult | null) => {
    state.resolve(result)
    bus.set(null)
  }

  const submit = () => {
    const trimmed = name.trim()
    if (trimmed === '') {
      toast.error(options.emptyMessage)
      inputRef.current?.focus()
      return
    }
    if (options.validate !== undefined) {
      const err = options.validate(trimmed)
      if (err !== null) {
        toast.error(err)
        inputRef.current?.focus()
        return
      }
    }
    close({ name: trimmed, icon })
  }

  const currentCategory = ICON_CATEGORIES.find(c => c.id === tab) ?? ICON_CATEGORIES[0]

  return (
    <div
      className={`${css.femOverlay} ${visible ? css.femVisible : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (pickerOpen) setPickerOpen(false)
          else close(null)
        }
      }}
    >
      <div className={css.fem}>
        <div className={css.femHeader}>
          <h3>{options.title}</h3>
        </div>
        <div className={css.femBody}>
          <div className={css.femInputRow}>
            <button
              ref={iconBtnRef}
              type="button"
              className={css.femIconBtn}
              title="选择图标"
              onClick={() => { setPickerOpen(v => !v) }}
            >
              {icon === '' ? <FolderGlyph size={22} /> : icon}
            </button>
            <input
              ref={inputRef}
              className={css.femInput}
              type="text"
              value={name}
              placeholder={options.placeholder}
              maxLength={options.maxLength ?? 50}
              onChange={(e) => { setName(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            {pickerOpen && (
              <div ref={pickerRef} className={css.iconPicker}>
                <div className={css.iconPickerTabs}>
                  {ICON_CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`${css.iconPickerTab} ${cat.id === tab ? css.iconPickerTabActive : ''}`}
                      onClick={() => { setTab(cat.id) }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                <div className={css.iconGrid}>
                  {currentCategory.icons.map((ic, i) => (
                    <span
                      key={`${ic}-${String(i)}`}
                      className={`${css.iconItem} ${ic === icon ? css.iconItemSelected : ''}`}
                      title={ic === '' ? '默认' : ic}
                      onClick={() => {
                        setIcon(ic)
                        setPickerOpen(false)
                      }}
                    >
                      {ic === '' ? <FolderGlyph /> : ic}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className={css.femFooter}>
          <button type="button" className={css.femCancel} onClick={() => { close(null) }}>
            {options.cancelText}
          </button>
          <button type="button" className={css.femConfirm} onClick={submit}>
            {options.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Mac 平台（默认文件夹渐变用蓝色系，原 isMac 判断）。 */
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
/** 默认文件夹渐变色（原 gradColors：mac 蓝 / win 黄）。 */
const GLYPH_COLORS = IS_MAC
  ? { top: '#6CC4F8', bottom: '#3B9FE7' }
  : { top: '#FFD666', bottom: '#E5A520' }

/** 默认文件夹图标（原 folderSvg：mac/win 渐变双层文件夹）。 */
function FolderGlyph({ size = 18 }: { readonly size?: number }) {
  const gradId = useId()
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GLYPH_COLORS.top} />
          <stop offset="100%" stopColor={GLYPH_COLORS.bottom} />
        </linearGradient>
      </defs>
      <path d="M2 6a2 2 0 0 1 2-2h4.6a2 2 0 0 1 1.5.7L11.4 6H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" fill={`url(#${gradId})`} />
      <path d="M2 9h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9z" fill={`url(#${gradId})`} opacity="0.85" />
    </svg>
  )
}

/**
 * 文件夹编辑弹窗宿主。
 * portal 到 body：收藏弹窗（时间轴）也直挂 body，挂在 shell.overlay
 * 里会被挡住。
 * @param props - dark 为宿主主题（portal 后需自带 data-theme）。
 * @returns 遮罩 + 对话框。
 */
export function FolderEditModalHost({ dark }: { readonly dark: boolean }) {
  const state = useSyncExternalStore(bus.subscribe, () => bus.get())
  if (state === null) return null
  return createPortal(
    <div className={`${css.root} ${css.femPortal}`} data-theme={dark ? 'dark' : 'light'}>
      <ModalInstance key={state.id} state={state} />
    </div>,
    document.body,
  )
}
