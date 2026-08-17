/**
 * 闪记面板：移植原扩展 NotepadManager（多笔记浮窗）。
 * - 右下角锚定的可拖拽/8 向调整大小浮窗（几何持久化）；
 * - 编辑视图（textarea + 600ms 防抖保存 + Tab 缩进 + 失焦预览层）与
 *   列表视图（按更新时间倒序、hover 删除、时间格式化）切换；
 * - 半透明失焦态：点击面板内获得焦点（opacity 1），点击外部失焦（0.55）；
 * - 底部「保存到文件夹」：笔记以 `notepad:{noteId}` 收藏进文件夹体系；
 * - 命令式 notepad API（open/close/toggle/openNote），收藏树导航复用。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { Bus } from '../ui/bus.ts'
import { tooltip } from '../ui/tooltip.tsx'
import { popconfirm } from '../ui/popconfirm.tsx'
import { starredStore } from '../starred/storage.ts'
import { starEditModal } from '../timeline/StarModal.tsx'
import {
  DEFAULT_HEIGHT, DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH,
  loadGeometry, noteStarKey, notesStore, saveGeometry, type Note,
} from './storage.ts'
import css from './notepad.module.css'

type T = TranslateNS<typeof NS>

/** 面板 UI 状态（原实例字段 isOpen/currentView/activeNoteId + focused 类）。 */
interface NotepadUiState {
  readonly open: boolean
  readonly focused: boolean
  readonly view: 'edit' | 'list'
  readonly activeNoteId: string | null
}

const uiBus = new Bus<NotepadUiState>({ open: false, focused: false, view: 'edit', activeNoteId: null })

/** 宿主注册的「立即保存当前笔记」回调（原 _flushCurrentNote）。 */
let hostFlush: (() => void) | null = null

/** 打开时的目标笔记：无笔记则新建，否则用最近一条（原 open()）。 */
function resolveNoteToOpen(preferred: string | null): string {
  const notes = notesStore.getAll()
  if (preferred !== null && notes.some(n => n.id === preferred)) return preferred
  if (notes.length === 0) return notesStore.create().id
  return notes[notes.length - 1].id
}

/** 命令式闪记 API（等价原 window.notepadManager）。 */
export const notepad = {
  isOpen: (): boolean => uiBus.get().open,

  open(): void {
    const state = uiBus.get()
    if (state.open) return
    const id = resolveNoteToOpen(state.activeNoteId)
    uiBus.set({ open: true, focused: true, view: 'edit', activeNoteId: id })
  },

  close(): void {
    const state = uiBus.get()
    if (!state.open) return
    hostFlush?.()
    uiBus.set({ ...state, open: false, focused: false })
  },

  /** 开→关（已聚焦时）/ 聚焦（半透明时），关→开（原 toggle）。 */
  toggle(): void {
    const state = uiBus.get()
    if (!state.open) {
      this.open()
    } else if (state.focused) {
      this.close()
    } else {
      uiBus.set({ ...state, focused: true })
    }
  },

  /** 打开指定笔记（收藏树导航入口）。 */
  openNote(noteId: string): void {
    hostFlush?.()
    if (notesStore.getById(noteId) === undefined) return
    uiBus.set({ open: true, focused: true, view: 'edit', activeNoteId: noteId })
  },
}

/** 提取标题：首行前 40 字（原 _extractTitle）。 */
function extractTitle(content: string): string {
  if (content === '') return ''
  const firstLine = content.split('\n')[0].trim()
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine
}

/** 列表时间格式化（原 _formatTime：今天 HH:mm / 昨天 / 今年 M/D / 往年 Y/M/D）。 */
function formatTime(ts: number, yesterdayLabel: string): string {
  if (ts === 0) return ''
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')

  if (d.toDateString() === now.toDateString()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) {
    return `${yesterdayLabel} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 默认位置：时间轴 wrapper 左侧 + 入口按钮底对齐（原 _calcDefaultPosition）。 */
function calcDefaultPosition(size: { width: number; height: number }): { right: number; bottom: number } {
  const wrapper = document.querySelector('[data-dsh-tl-wrapper]')
  let right: number
  let bottom: number
  if (wrapper !== null) {
    const wRect = wrapper.getBoundingClientRect()
    right = (window.innerWidth - wRect.left) + 8
    const btn = document.querySelector('[data-dsh-notepad-btn]')
    if (btn !== null) {
      bottom = window.innerHeight - btn.getBoundingClientRect().bottom
    } else {
      bottom = window.innerHeight - wRect.bottom
    }
  } else {
    right = 20
    bottom = window.innerHeight - size.height - 100
  }
  return { right: Math.max(0, right), bottom: Math.max(0, bottom) }
}

/** 面板 props。 */
export interface NotepadHostProps {
  readonly dark: boolean
  readonly t: T
}

/** 闪记面板宿主（挂在 UiHost 内）。 */
export function NotepadHost({ dark, t }: NotepadHostProps) {
  const ui = useSyncExternalStore(uiBus.subscribe, () => uiBus.get())
  const notes = useSyncExternalStore(notesStore.subscribe, () => notesStore.getAll())
  const starredState = useSyncExternalStore(starredStore.subscribe, () => starredStore.getState())

  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 几何：右下角锚定（原 position/size 实例字段，命令式写样式）。
  const geoRef = useRef(loadGeometry())

  const valueRef = useRef(value)
  valueRef.current = value
  const uiRef = useRef(ui)
  uiRef.current = ui

  /** 立即保存当前笔记（原 _flushCurrentNote）。 */
  const flush = (): void => {
    if (saveTimerRef.current !== null) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const id = uiRef.current.activeNoteId
    if (id !== null) notesStore.updateContent(id, valueRef.current)
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    hostFlush = () => { flushRef.current() }
    return () => { hostFlush = null }
  }, [])

  // 笔记切换 / 外部（跨标签页）内容变化 → 同步编辑器。
  const activeNote: Note | undefined = ui.activeNoteId !== null ? notes.find(n => n.id === ui.activeNoteId) : undefined
  const lastSyncedRef = useRef<{ id: string | null; content: string }>({ id: null, content: '' })
  useEffect(() => {
    const id = activeNote?.id ?? null
    const content = activeNote?.content ?? ''
    const last = lastSyncedRef.current
    if (last.id !== id || (content !== last.content && content !== valueRef.current)) {
      lastSyncedRef.current = { id, content }
      setValue(content)
      // 内容更新后光标定位末尾（原 openNote / storage 同步行为）。
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (ta !== null) ta.selectionStart = ta.selectionEnd = ta.value.length
      })
    } else {
      lastSyncedRef.current = { id, content }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id, activeNote?.content])

  /** 应用几何到面板（原 applyState：锚定换算 + 视口夹取）。 */
  const applyGeometry = (): void => {
    const panel = panelRef.current
    if (panel === null) return
    const geo = geoRef.current
    if (geo.position.right === null || geo.position.bottom === null) {
      geoRef.current = { ...geo, position: calcDefaultPosition(geo.size) }
    }
    const { position, size } = geoRef.current
    const x = window.innerWidth - (position.right ?? 0) - size.width
    const y = window.innerHeight - (position.bottom ?? 0) - size.height
    panel.style.width = `${size.width}px`
    panel.style.height = `${size.height}px`
    panel.style.left = `${Math.max(0, Math.min(window.innerWidth - size.width, x))}px`
    panel.style.top = `${Math.max(0, Math.min(window.innerHeight - size.height, y))}px`
  }

  // 打开时应用几何；窗口 resize 重新换算（原 _onWindowResize）。
  useEffect(() => {
    if (!ui.open) return
    applyGeometry()
    const onResize = (): void => { applyGeometry() }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.open])

  // 聚焦编辑视图时 textarea 聚焦 + 光标末尾（原 open/_setFocused 的 rAF）。
  useEffect(() => {
    if (!ui.open || !ui.focused || ui.view !== 'edit') return
    const raf = requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta === null) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
    return () => { cancelAnimationFrame(raf) }
  }, [ui.open, ui.focused, ui.view, ui.activeNoteId])

  // 失焦时保存（原 _setFocused(false) 的 flush + blur）。
  useEffect(() => {
    if (ui.focused) return
    flushRef.current()
    textareaRef.current?.blur()
  }, [ui.focused])

  // 点击面板内/外切换聚焦态（原 _onFocusCheck，capture mousedown）。
  useEffect(() => {
    const onFocusCheck = (e: MouseEvent): void => {
      const state = uiRef.current
      if (!state.open) return
      const panel = panelRef.current
      if (panel === null) return
      if (e.target instanceof Element && e.target.closest('[data-dsh-notepad-btn]') !== null) return
      const rect = panel.getBoundingClientRect()
      const inside = e.clientX >= rect.left && e.clientX <= rect.right
        && e.clientY >= rect.top && e.clientY <= rect.bottom
      if (inside !== state.focused) uiBus.set({ ...state, focused: inside })
    }
    document.addEventListener('mousedown', onFocusCheck, true)
    return () => { document.removeEventListener('mousedown', onFocusCheck, true) }
  }, [])

  // ==== 拖动与调整大小（与原 runner 逻辑完全一致） ====
  useEffect(() => {
    let dragging = false
    let dragOffset = { x: 0, y: 0 }
    let resizing: string | null = null
    let resizeStart = { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 }

    const setPosition = (x: number, y: number): void => {
      const panel = panelRef.current
      if (panel === null) return
      const w = panel.offsetWidth
      const h = panel.offsetHeight
      const cx = Math.max(0, Math.min(window.innerWidth - w, x))
      const cy = Math.max(0, Math.min(window.innerHeight - h, y))
      panel.style.left = `${cx}px`
      panel.style.top = `${cy}px`
      geoRef.current = {
        ...geoRef.current,
        position: { right: window.innerWidth - cx - w, bottom: window.innerHeight - cy - h },
      }
    }

    const cursorFor = (dir: string): string => {
      const cursors: Record<string, string> = {
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
        ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
      }
      return cursors[dir] ?? 'default'
    }

    const onPanelMouseDown = (e: MouseEvent): void => {
      const panel = panelRef.current
      if (panel === null || !(e.target instanceof Element)) return
      const handle = e.target.closest(`.${css.resizeHandle}`)
      if (handle instanceof HTMLElement) {
        resizing = handle.getAttribute('data-direction')
        resizeStart = {
          x: e.clientX,
          y: e.clientY,
          width: panel.offsetWidth,
          height: panel.offsetHeight,
          left: panel.offsetLeft,
          top: panel.offsetTop,
        }
        document.body.style.userSelect = 'none'
        document.body.style.cursor = cursorFor(resizing ?? '')
        return
      }
      const header = e.target.closest(`.${css.header}`)
      if (header !== null && e.target.closest('button') === null) {
        dragging = true
        const rect = panel.getBoundingClientRect()
        dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        document.body.style.userSelect = 'none'
      }
    }

    const onMouseMove = (e: MouseEvent): void => {
      if (dragging) {
        setPosition(e.clientX - dragOffset.x, e.clientY - dragOffset.y)
      }
      if (resizing !== null) {
        const panel = panelRef.current
        if (panel === null) return
        const { x, y, width, height, left, top } = resizeStart
        const dx = e.clientX - x
        const dy = e.clientY - y
        let newWidth = width
        let newHeight = height
        let newLeft = left
        let newTop = top
        if (resizing.includes('e')) newWidth = Math.max(MIN_WIDTH, width + dx)
        if (resizing.includes('w')) {
          newWidth = Math.max(MIN_WIDTH, width - dx)
          newLeft = left + (width - newWidth)
        }
        if (resizing.includes('s')) newHeight = Math.max(MIN_HEIGHT, height + dy)
        if (resizing.includes('n')) {
          newHeight = Math.max(MIN_HEIGHT, height - dy)
          newTop = top + (height - newHeight)
        }
        panel.style.width = `${newWidth}px`
        panel.style.height = `${newHeight}px`
        panel.style.left = `${newLeft}px`
        panel.style.top = `${newTop}px`
        geoRef.current = {
          size: { width: newWidth, height: newHeight },
          position: {
            right: window.innerWidth - newLeft - newWidth,
            bottom: window.innerHeight - newTop - newHeight,
          },
        }
      }
    }

    const onMouseUp = (): void => {
      if (dragging || resizing !== null) {
        dragging = false
        resizing = null
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        saveGeometry(geoRef.current)
      }
    }

    const panel = panelRef.current
    panel?.addEventListener('mousedown', onPanelMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      panel?.removeEventListener('mousedown', onPanelMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // ==== 交互（原 bindEvents 的按钮部分） ====

  const scheduleSave = (): void => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      flushRef.current()
    }, 600)
  }

  /** 新建笔记（原 createNote：当前笔记为空时复用）。 */
  const createNote = (): void => {
    flushRef.current()
    const state = uiRef.current
    if (state.activeNoteId !== null) {
      const current = notesStore.getById(state.activeNoteId)
      if (current !== undefined && current.content.trim() === '') {
        uiBus.set({ ...state, view: 'edit', focused: true })
        return
      }
    }
    const note = notesStore.create()
    uiBus.set({ ...state, view: 'edit', activeNoteId: note.id, focused: true })
  }

  /** 打开列表视图（原 showListView：先保存当前笔记）。 */
  const showListView = (): void => {
    flushRef.current()
    uiBus.set({ ...uiRef.current, view: 'list', activeNoteId: null })
  }

  const openNote = (id: string): void => {
    flushRef.current()
    uiBus.set({ ...uiRef.current, view: 'edit', activeNoteId: id })
  }

  /** 删除笔记（原 deleteNote：确认后连同收藏记录删除）。 */
  const deleteNote = async (id: string): Promise<void> => {
    const confirmed = await popconfirm.show({
      title: t('notepad.confirmDeleteTitle'),
      content: t('notepad.confirmDeleteContent'),
      confirmText: t('starred.delete'),
      cancelText: t('common.cancel'),
    })
    if (!confirmed) return
    notesStore.remove(id)
    starredStore.removeStar(noteStarKey(id))
    const state = uiRef.current
    const rest = notesStore.getAll()
    if (rest.length === 0) {
      const note = notesStore.create()
      uiBus.set({ ...state, view: 'edit', activeNoteId: note.id, focused: true })
    } else {
      uiBus.set({
        ...state,
        activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
        focused: true,
      })
    }
  }

  /** 收藏到文件夹（原 _showFolderPicker：starInputModal + StarStorage upsert）。 */
  const showFolderPicker = async (): Promise<void> => {
    const state = uiRef.current
    if (state.activeNoteId === null) return
    flushRef.current()
    const note = notesStore.getById(state.activeNoteId)
    if (note === undefined) return
    const starKey = noteStarKey(state.activeNoteId)
    const existing = starredStore.findByKey(starKey)
    const defaultTitle = existing?.question ?? extractTitle(note.content)

    const result = await starEditModal.show({
      title: t('starred.starChat'),
      defaultValue: defaultTitle,
      defaultFolderId: existing?.folderId ?? null,
    })
    const cur = uiRef.current
    if (result === null) {
      if (cur.open) uiBus.set({ ...cur, focused: true })
      return
    }
    starredStore.addStar({
      key: starKey,
      sessionId: 'notepad',
      nodeKey: state.activeNoteId,
      question: result.value.trim() !== '' ? result.value.trim() : defaultTitle,
      timestamp: Date.now(),
      folderId: result.folderId,
    })
    if (cur.open) uiBus.set({ ...cur, focused: true })
  }

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = `${ta.value.substring(0, start)}    ${ta.value.substring(end)}`
    setValue(next)
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4 })
    scheduleSave()
  }

  // ==== 渲染 ====

  // 头部按钮 mini tooltip（原 _bindHeaderButtonTooltip，style: 'mini'）。
  const headerBtnTooltip = (text: string): {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void
    onMouseLeave: () => void
  } => ({
    onMouseEnter: (e) => { tooltip.showOverlay(e.currentTarget, text, { placement: 'top' }) },
    onMouseLeave: () => { tooltip.hideOverlay() },
  })

  // 底部位置栏（原 _updateLocationDisplay：同步读 starredStore，
  // starredState 订阅保证收藏/文件夹变化时联动刷新）。
  void starredState
  const activeStar = ui.activeNoteId !== null ? starredStore.findByKey(noteStarKey(ui.activeNoteId)) : undefined
  const folderPath = activeStar?.folderId !== undefined && activeStar.folderId !== null
    ? starredStore.getFolderPath(activeStar.folderId)
    : ''

  // 列表数据（原 _renderList：倒序 + 收藏映射）。
  const sortedNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)

  const panelClass = [
    css.panel,
    ui.open ? css.visible : '',
    ui.focused ? css.focused : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={panelRef}
      className={panelClass}
      data-theme={dark ? 'dark' : 'light'}
    >
      <div className={css.header}>
        <span className={css.title}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="16"
            height="16"
          >
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
          {t('notepad.title')}
        </span>
        <div className={css.headerRight}>
          {notes.length >= 1
            ? (
              <button
                type="button"
                className={css.headerBtn}
                aria-label={t('notepad.allNotes')}
                onClick={(e) => { e.stopPropagation(); showListView() }}
                {...headerBtnTooltip(t('notepad.allNotes'))}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </button>
            )
            : null}
          <button
            type="button"
            className={css.headerBtn}
            aria-label={t('notepad.newNote')}
            onClick={(e) => { e.stopPropagation(); createNote() }}
            {...headerBtnTooltip(t('notepad.newNote'))}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            className={css.headerBtn}
            aria-label={t('notepad.close')}
            onClick={(e) => { e.stopPropagation(); notepad.close() }}
            {...headerBtnTooltip(t('notepad.close'))}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className={css.body}>
        <div className={ui.view === 'list' ? `${css.list} ${css.listVisible}` : css.list}>
          {sortedNotes.map((note) => {
            const star = starredStore.findByKey(noteStarKey(note.id))
            const contentTitle = extractTitle(note.content) !== '' ? extractTitle(note.content) : t('notepad.untitled')
            const path = star?.folderId !== undefined && star.folderId !== null
              ? starredStore.getFolderPath(star.folderId)
              : ''
            return (
              <div key={note.id} className={css.item} onClick={() => { openNote(note.id) }}>
                <div className={css.itemContent}>
                  <div className={css.itemTitle}>{contentTitle}</div>
                  {path !== ''
                    ? (
                      <div className={css.itemFolderLine}>
                        <span className={css.itemFolder}>{path}</span>
                        {star !== undefined && star.question !== ''
                          ? <span className={css.itemStarTitle}>{star.question}</span>
                          : null}
                      </div>
                    )
                    : null}
                  <div className={css.itemMeta}>
                    <span className={css.itemTime}>{formatTime(note.updatedAt, t('notepad.yesterday'))}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={css.itemDelete}
                  title={t('starred.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteNote(note.id)
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
        <textarea
          ref={textareaRef}
          className={css.editor}
          placeholder={t('notepad.placeholder')}
          value={value}
          style={ui.view === 'list' ? { display: 'none' } : undefined}
          tabIndex={ui.focused ? undefined : -1}
          aria-hidden={ui.focused ? undefined : true}
          onChange={(e) => {
            setValue(e.target.value)
            scheduleSave()
          }}
          onKeyDown={onTextareaKeyDown}
        />
        <div
          className={value === '' ? `${css.preview} ${css.previewEmpty}` : css.preview}
          aria-hidden
          hidden={ui.view === 'list'}
        >
          {value !== '' ? value : t('notepad.placeholder')}
        </div>
      </div>
      {ui.view === 'edit'
        ? (
          <div className={css.footer}>
            <div
              className={css.location}
              onClick={(e) => {
                e.stopPropagation()
                void showFolderPicker()
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              {folderPath !== ''
                ? (
                  <span className={css.locationText}>
                    <span className={css.locFolder}>{folderPath}</span>
                    {activeStar !== undefined && activeStar.question !== ''
                      ? <span className={css.locTitle}>{activeStar.question}</span>
                      : null}
                  </span>
                )
                : <span className={`${css.locationText} ${css.locationEmpty}`}>{t('notepad.saveToFolder')}</span>}
            </div>
          </div>
        )
        : null}
      {(['se', 'sw', 'ne', 'nw', 'e', 'w', 'n', 's'] as const).map(dir => (
        <div key={dir} className={css.resizeHandle} data-direction={dir} />
      ))}
    </div>
  )
}

/** 时间轴上的闪记入口按钮（原 .ait-notepad-btn）。 */
export function NotepadButton({ t }: { readonly t: T }) {
  const ui = useSyncExternalStore(uiBus.subscribe, () => uiBus.get())
  return (
    <button
      type="button"
      className={ui.open ? `${css.notepadBtn} ${css.notepadBtnActive}` : css.notepadBtn}
      aria-label={t('notepad.title')}
      data-dsh-notepad-btn
      onClick={() => { notepad.toggle() }}
      onMouseEnter={(e) => {
        tooltip.show('notepad-btn', e.currentTarget, t('notepad.title'), { placement: 'left' })
      }}
      onMouseLeave={() => { tooltip.hide() }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    </button>
  )
}
