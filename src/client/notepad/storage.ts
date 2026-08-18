/**
 * 闪记数据层：移植原扩展 NotepadManager 的存储部分
 * （chrome.storage.local aitNotepadNotes / aitNotepadState → localStorage）。
 * - 笔记数组 [{id, content, updatedAt}]，上限 50 条（超出淘汰最旧）；
 * - 面板几何（右下角锚定 right/bottom + 宽高）单独持久化；
 * - storage 事件跨标签页同步（等价原 chrome.storage.onChanged）。
 */
import { Bus } from '../ui/bus.ts'

/** 笔记（原 aitNotepadNotes 数组元素）。 */
export interface Note {
  readonly id: string
  readonly content: string
  readonly updatedAt: number
}

/** 面板几何状态（原 aitNotepadState）。 */
export interface NotepadGeometry {
  readonly position: { readonly right: number | null; readonly bottom: number | null }
  readonly size: { readonly width: number; readonly height: number }
}

/** 笔记数上限（原 MAX_NOTES）。 */
export const MAX_NOTES = 50
/** 默认/最小尺寸（原常量）。 */
export const DEFAULT_WIDTH = 260
export const DEFAULT_HEIGHT = 370
export const MIN_WIDTH = 240
export const MIN_HEIGHT = 280

const NOTES_KEY = 'dsh.timeline.notepad.notes'
const STATE_KEY = 'dsh.timeline.notepad.state'

function loadNotes(): readonly Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as Note[]
    }
  } catch { /* 损坏数据回退为空 */ }
  return []
}

const notesBus = new Bus<readonly Note[]>(loadNotes())

function saveNotes(next: readonly Note[]): void {
  notesBus.set(next)
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)) } catch { /* 存储满时忽略 */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === NOTES_KEY) notesBus.set(loadNotes())
  })
}

/** 生成笔记 id（原 createNote 的 id 生成）。 */
function newNoteId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 笔记存储 API。 */
export const notesStore = {
  subscribe: notesBus.subscribe,
  getAll: (): readonly Note[] => notesBus.get(),

  getById(id: string): Note | undefined {
    return notesBus.get().find(n => n.id === id)
  },

  /** 新建空笔记（超上限时淘汰最旧一条）。 */
  create(): Note {
    let list = notesBus.get()
    if (list.length >= MAX_NOTES) {
      const sorted = [...list].sort((a, b) => a.updatedAt - b.updatedAt)
      list = list.filter(n => n.id !== sorted[0].id)
    }
    const note: Note = { id: newNoteId(), content: '', updatedAt: Date.now() }
    saveNotes([...list, note])
    return note
  },

  /** 更新笔记内容（原 _flushCurrentNote：内容变化时刷新 updatedAt）。 */
  updateContent(id: string, content: string): void {
    const list = notesBus.get()
    const note = list.find(n => n.id === id)
    if (note === undefined || note.content === content) return
    saveNotes(list.map(n => (n.id === id ? { ...n, content, updatedAt: Date.now() } : n)))
  },

  remove(id: string): void {
    saveNotes(notesBus.get().filter(n => n.id !== id))
  },
}

/** 读取面板几何（原 loadState）。 */
export function loadGeometry(): NotepadGeometry {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<NotepadGeometry>
      return {
        position: {
          right: parsed.position?.right ?? null,
          bottom: parsed.position?.bottom ?? null,
        },
        size: {
          width: parsed.size?.width ?? DEFAULT_WIDTH,
          height: parsed.size?.height ?? DEFAULT_HEIGHT,
        },
      }
    }
  } catch { /* 回退默认 */ }
  return { position: { right: null, bottom: null }, size: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT } }
}

/** 持久化面板几何（原 saveState）。 */
export function saveGeometry(geometry: NotepadGeometry): void {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(geometry)) } catch { /* 忽略 */ }
}

/** 笔记对应的收藏 key（原 `chatTimelineStar:notepad:{noteId}`）。 */
export function noteStarKey(noteId: string): string {
  return `notepad:${noteId}`
}
