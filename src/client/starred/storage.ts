/**
 * 收藏与文件夹全局存储：移植原扩展 StarStorageManager + FolderManager +
 * PinStorageManager 的数据层（原 chrome.storage.local → localStorage）。
 * - 收藏项：数组结构，key = `${sessionId}:${nodeKey}`（整会话 nodeKey='-1'，
 *   对应原 `chatTimelineStar:{url}:{index}` / index=-1 的页面级收藏）；
 * - 文件夹：最多两级（根 + 子），createdAt/order/pinned/icon 字段齐平原版；
 * - 树构建 getStarredByFolder 逐行移植（置顶排序、未分类兜底）；
 * - 模块级单例 + Bus 订阅（React 组件 useSyncExternalStore 接入），
 *   storage 事件实现跨标签页同步（等价原 chrome.storage.onChanged）。
 */
import { Bus } from '../ui/bus.ts'

/** 收藏项（原 chatTimelineStars 数组元素）。 */
export interface StarItem {
  /** `${sessionId}:${nodeKey}`；整会话为 `${sessionId}:-1`。 */
  readonly key: string
  readonly sessionId: string
  /** 节点 key；'-1' 表示整会话收藏（原 index=-1）。 */
  readonly nodeKey: string
  /** 主题（原 question）。 */
  readonly question: string
  readonly timestamp: number
  readonly folderId: string | null
  readonly pinned?: boolean
}

/** 文件夹（原 folders 数组元素）。 */
export interface Folder {
  readonly id: string
  readonly name: string
  /** emoji 图标；空串 = 默认文件夹图标。 */
  readonly icon: string
  readonly parentId: string | null
  readonly createdAt: number
  readonly order: number
  readonly pinned?: boolean
}

/** 树节点（原 getStarredByFolder 返回结构）。 */
export interface FolderNode extends Folder {
  readonly children: readonly FolderNode[]
  readonly items: readonly StarItem[]
}

/** 收藏树。 */
export interface StarredTreeData {
  readonly folders: readonly FolderNode[]
  readonly uncategorized: readonly StarItem[]
}

interface StarredState {
  readonly folders: readonly Folder[]
  readonly items: readonly StarItem[]
}

const STORAGE_KEY = 'dsh.timeline.starred.v1'

function load(): StarredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { folders: [], items: [] }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const p = parsed as { folders?: unknown; items?: unknown }
      return {
        folders: Array.isArray(p.folders) ? p.folders as Folder[] : [],
        items: Array.isArray(p.items) ? p.items as StarItem[] : [],
      }
    }
  } catch { /* 损坏数据回退为空 */ }
  return { folders: [], items: [] }
}

const bus = new Bus<StarredState>(load())

function save(next: StarredState): void {
  bus.set(next)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* 存储满时忽略 */ }
}

// 跨标签页同步（等价原 chrome.storage.onChanged）。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) bus.set(load())
  })
}

/** 生成文件夹 id（原 `folder_${Date.now()}_${random}`）。 */
function newFolderId(): string {
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/** 收藏项按置顶排序（原 sortItems：pinned 在前，其余保持存储顺序）。 */
function sortItems(arr: readonly StarItem[]): readonly StarItem[] {
  return [...arr].sort((a, b) => {
    if (a.pinned === true && b.pinned !== true) return -1
    if (a.pinned !== true && b.pinned === true) return 1
    return 0
  })
}

/** 收藏存储 API（等价原 window 单例组合）。 */
export const starredStore = {
  subscribe: bus.subscribe,
  getState: (): StarredState => bus.get(),

  // ==== StarStorageManager 面 ====

  getAll(): readonly StarItem[] {
    return bus.get().items
  },

  findByKey(key: string): StarItem | undefined {
    return bus.get().items.find(i => i.key === key)
  },

  exists(key: string): boolean {
    return this.findByKey(key) !== undefined
  },

  /** 添加或更新收藏（原 add：按 key upsert）。 */
  addStar(item: StarItem): void {
    const state = bus.get()
    const idx = state.items.findIndex(i => i.key === item.key)
    const items = idx >= 0
      ? state.items.map((i, n) => (n === idx ? item : i))
      : [...state.items, item]
    save({ ...state, items })
  },

  removeStar(key: string): void {
    const state = bus.get()
    save({ ...state, items: state.items.filter(i => i.key !== key) })
  },

  updateStar(key: string, updates: Partial<StarItem>): void {
    const state = bus.get()
    const idx = state.items.findIndex(i => i.key === key)
    if (idx < 0) return
    const items = state.items.map((i, n) => (n === idx ? { ...i, ...updates } : i))
    save({ ...state, items })
  },

  togglePinStarred(key: string): void {
    const item = this.findByKey(key)
    if (item === undefined) return
    this.updateStar(key, { pinned: item.pinned !== true })
  },

  // ==== FolderManager 面 ====

  getFolders(): readonly Folder[] {
    return bus.get().folders
  },

  /**
   * 创建文件夹（最多两级；order = 同级数量）。
   * @throws 超过两级时抛错（原版行为）。
   */
  createFolder(name: string, parentId: string | null = null, icon = ''): Folder {
    const state = bus.get()
    if (parentId !== null) {
      const parent = state.folders.find(f => f.id === parentId)
      if (parent !== undefined && parent.parentId !== null) {
        throw new Error('最多支持2级文件夹')
      }
    }
    const siblings = state.folders.filter(f => f.parentId === parentId)
    const folder: Folder = {
      id: newFolderId(),
      name,
      icon,
      parentId,
      createdAt: Date.now(),
      order: siblings.length,
    }
    save({ ...state, folders: [...state.folders, folder] })
    return folder
  },

  updateFolder(folderId: string, newName: string, newIcon?: string): void {
    const state = bus.get()
    const folders = state.folders.map(f => (
      f.id === folderId
        ? { ...f, name: newName, ...(newIcon !== undefined ? { icon: newIcon } : {}) }
        : f
    ))
    save({ ...state, folders })
  },

  /**
   * 删除文件夹（连同子文件夹）。
   * @param deleteItems - true：连同收藏项删除；false：收藏项移到未分类。
   */
  deleteFolder(folderId: string, deleteItems = true): void {
    const state = bus.get()
    const childIds = state.folders.filter(f => f.parentId === folderId).map(f => f.id)
    const deletedIds = new Set([folderId, ...childIds])
    const folders = state.folders.filter(f => !deletedIds.has(f.id))
    const items = deleteItems
      ? state.items.filter(i => i.folderId === null || !deletedIds.has(i.folderId))
      : state.items.map(i => (i.folderId !== null && deletedIds.has(i.folderId) ? { ...i, folderId: null } : i))
    save({ folders, items })
  },

  moveStarredToFolder(key: string, targetFolderId: string | null): void {
    this.updateStar(key, { folderId: targetFolderId })
  },

  /** 文件夹内重排收藏项（原 reorderStarredInFolder：基于数组顺序）。 */
  reorderStarredInFolder(key: string, targetFolderId: string | null, refKey: string | null, position: 'before' | 'after'): void {
    const state = bus.get()
    const items = [...state.items]
    const srcIdx = items.findIndex(i => i.key === key)
    if (srcIdx === -1) return
    const [moved] = items.splice(srcIdx, 1)
    const updated = { ...moved, folderId: targetFolderId }
    if (refKey === null) {
      items.push(updated)
    } else {
      const refIdx = items.findIndex(i => i.key === refKey)
      if (refIdx === -1) {
        items.push(updated)
      } else {
        items.splice(position === 'before' ? refIdx : refIdx + 1, 0, updated)
      }
    }
    save({ ...state, items })
  },

  /** 同级排序移动文件夹（原 moveFolderToPosition）。 */
  moveFolderToPosition(folderId: string, targetFolderId: string, position: 'before' | 'after'): void {
    const state = bus.get()
    const folders = state.folders.map(f => ({ ...f }))
    const folder = folders.find(f => f.id === folderId)
    const target = folders.find(f => f.id === targetFolderId)
    if (folder === undefined || target === undefined) return
    if ((folder.parentId ?? null) !== (target.parentId ?? null)) return

    const parentId = folder.parentId ?? null
    const siblings = folders.filter(f => (f.parentId ?? null) === parentId)
    siblings.sort((a, b) => a.order - b.order)

    const fromIdx = siblings.findIndex(f => f.id === folderId)
    if (fromIdx === -1) return
    siblings.splice(fromIdx, 1)
    const toIdx = siblings.findIndex(f => f.id === targetFolderId)
    if (toIdx === -1) return
    siblings.splice(position === 'before' ? toIdx : toIdx + 1, 0, folder)
    siblings.forEach((f, i) => { f.order = i })
    save({ ...state, folders })
  },

  /**
   * 跨级移动文件夹（原 moveFolderToParent）。
   * @returns ok 或错误码（hasChildren/maxDepth 等）。
   */
  moveFolderToParent(folderId: string, newParentId: string | null): { ok: boolean; error?: string } {
    const state = bus.get()
    const folders = state.folders.map(f => ({ ...f }))
    const folder = folders.find(f => f.id === folderId)
    if (folder === undefined) return { ok: false, error: 'Folder not found' }
    if ((folder.parentId ?? null) === (newParentId ?? null)) return { ok: true }
    if (newParentId === folderId) return { ok: false, error: 'Cannot move into itself' }

    if (newParentId !== null) {
      if (folders.some(f => f.parentId === folderId)) return { ok: false, error: 'hasChildren' }
      const parent = folders.find(f => f.id === newParentId)
      if (parent === undefined) return { ok: false, error: 'Target not found' }
      if (parent.parentId !== null) return { ok: false, error: 'maxDepth' }
    }

    const oldParentId = folder.parentId ?? null
    folder.parentId = newParentId
    const newSiblings = folders.filter(f => (f.parentId ?? null) === (newParentId ?? null) && f.id !== folderId)
    folder.order = newSiblings.length
    const oldSiblings = folders.filter(f => (f.parentId ?? null) === oldParentId && f.id !== folderId)
    oldSiblings.sort((a, b) => a.order - b.order)
    oldSiblings.forEach((f, i) => { f.order = i })
    save({ ...state, folders })
    return { ok: true }
  },

  togglePinFolder(folderId: string): void {
    const state = bus.get()
    const folders = state.folders.map(f => (f.id === folderId ? { ...f, pinned: f.pinned !== true } : f))
    save({ ...state, folders })
  },

  /** 文件夹路径（原 getFolderPath："父 / 子"）。 */
  getFolderPath(folderId: string | null): string {
    if (folderId === null) return ''
    const folders = bus.get().folders
    const folder = folders.find(f => f.id === folderId)
    if (folder === undefined) return ''
    if (folder.parentId !== null) {
      const parent = folders.find(f => f.id === folder.parentId)
      return parent !== undefined ? `${parent.name} / ${folder.name}` : folder.name
    }
    return folder.name
  },

  /** 同级重名检查（原 isFolderNameExists）。 */
  isFolderNameExists(name: string, parentId: string | null = null, excludeId: string | null = null): boolean {
    return bus.get().folders.some(f =>
      f.parentId === parentId && f.id !== excludeId && f.name === name,
    )
  },

  /** 按文件夹分组的收藏树（原 getStarredByFolder 逐行移植）。 */
  getStarredByFolder(): StarredTreeData {
    const { folders, items } = bus.get()
    const assigned = new Set<string>()

    const rootFolders = folders.filter(f => f.parentId === null).sort((a, b) => {
      if (a.pinned === true && b.pinned !== true) return -1
      if (a.pinned !== true && b.pinned === true) return 1
      return a.order - b.order
    })

    const tree: FolderNode[] = rootFolders.map((root) => {
      const childFolders = folders
        .filter(f => f.parentId === root.id)
        .sort((a, b) => a.order - b.order)
      const children: FolderNode[] = childFolders.map((child) => {
        const childItems = items.filter(i => i.folderId === child.id)
        for (const i of childItems) assigned.add(i.key)
        return { ...child, children: [], items: sortItems(childItems) }
      })
      const rootItems = items.filter(i => i.folderId === root.id)
      for (const i of rootItems) assigned.add(i.key)
      return { ...root, children, items: sortItems(rootItems) }
    })

    const uncategorized = sortItems(items.filter(i => !assigned.has(i.key)))
    return { folders: tree, uncategorized }
  },
}

// ==== 折叠/展开状态（原 sidebarStarredFolderStates / sidebarStarredCollapsed） ====

const UI_KEY = 'dsh.timeline.starred.ui.v1'

interface StarredUiState {
  readonly folderStates: Readonly<Record<string, boolean>>
  readonly collapsed: boolean
}

function loadUi(): StarredUiState {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<StarredUiState>
      return {
        folderStates: parsed.folderStates ?? {},
        collapsed: parsed.collapsed === true,
      }
    }
  } catch { /* 回退默认 */ }
  return { folderStates: {}, collapsed: false }
}

const uiBus = new Bus<StarredUiState>(loadUi())

/** 收藏面板 UI 状态（文件夹展开态 + 面板折叠态）。 */
export const starredUiStore = {
  subscribe: uiBus.subscribe,
  getState: (): StarredUiState => uiBus.get(),
  setFolderState(folderId: string, expanded: boolean): void {
    const state = uiBus.get()
    const next = { ...state, folderStates: { ...state.folderStates, [folderId]: expanded } }
    uiBus.set(next)
    try { localStorage.setItem(UI_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
  },
  setCollapsed(collapsed: boolean): void {
    const next = { ...uiBus.get(), collapsed }
    uiBus.set(next)
    try { localStorage.setItem(UI_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
  },
}

// ==== 图钉标记（原 PinStorageManager：chatTimelinePins） ====

/** 图钉项（原 chatTimelinePins 数组元素）。 */
export interface PinItem {
  /** `${sessionId}:${nodeKey}`。 */
  readonly key: string
  readonly sessionId: string
  readonly nodeKey: string
  readonly question: string
  readonly timestamp: number
}

const PINS_KEY = 'dsh.timeline.pins.v1'

function loadPins(): readonly PinItem[] {
  try {
    const raw = localStorage.getItem(PINS_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as PinItem[]
    }
  } catch { /* 损坏数据回退为空 */ }
  return []
}

const pinsBus = new Bus<readonly PinItem[]>(loadPins())

function savePins(next: readonly PinItem[]): void {
  pinsBus.set(next)
  try { localStorage.setItem(PINS_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === PINS_KEY) pinsBus.set(loadPins())
  })
}

/** 图钉存储 API（等价原 PinStorageManager）。 */
export const pinsStore = {
  subscribe: pinsBus.subscribe,
  getAll: (): readonly PinItem[] => pinsBus.get(),
  exists(key: string): boolean {
    return pinsBus.get().some(p => p.key === key)
  },
  /** 切换图钉（原 togglePin）。@returns 切换后是否已标记。 */
  toggle(item: PinItem): boolean {
    const list = pinsBus.get()
    if (list.some(p => p.key === item.key)) {
      savePins(list.filter(p => p.key !== item.key))
      return false
    }
    savePins([...list, item])
    return true
  },
}

// ==== 待跳转数据（原 chatTimelineNavigate / setNavigateDataForUrl） ====

/** 待滚动目标（跨会话导航后由时间轴消费）。 */
export interface PendingNavigate {
  readonly sessionId: string
  readonly nodeKey: string
}

const navBus = new Bus<PendingNavigate | null>(null)

/** 跨会话导航后的待滚动目标。 */
export const pendingNavigateStore = {
  subscribe: navBus.subscribe,
  get: (): PendingNavigate | null => navBus.get(),
  set(target: PendingNavigate | null): void { navBus.set(target) },
  /** 消费并清除（匹配 sessionId 时返回 nodeKey）。 */
  consume(sessionId: string): string | null {
    const cur = navBus.get()
    if (cur === null || cur.sessionId !== sessionId) return null
    navBus.set(null)
    return cur.nodeKey
  },
}
