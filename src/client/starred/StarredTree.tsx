/**
 * 收藏树：移植原扩展 StarredTreeRenderer（sidebar 场景）。
 * - 两级文件夹 + 收藏项层级渲染，置顶排序、展开态持久化；
 * - 单击导航（同会话滚动 / 跨会话 openSession + 待滚动目标）、双击编辑；
 * - hover 操作（… 菜单：置顶/编辑/移动/复制/取消收藏，文件夹：新建子级/
 *   置顶/重命名/删除）；名称溢出时右侧 tooltip；
 * - 收藏项自定义鼠标拖拽（5px 阈值 + 幽灵 + 精确落点指示 + 拖出取消收藏），
 *   文件夹 HTML5 拖拽（同级排序 before/after + 跨级 inside）。
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import { Bus } from '../ui/bus.ts'
import { dropdown, type DropdownItem } from '../ui/dropdown.tsx'
import { findMessageElement, findScrollContainer } from '../timeline/TimelineBar.tsx'
import { smoothScrollTo } from '../timeline/engine.ts'
import { starEditModal } from '../timeline/StarModal.tsx'
import { notepad } from '../notepad/NotepadPanel.tsx'
import {
  pendingNavigateStore, starredStore, starredUiStore,
  type FolderNode, type StarItem,
} from './storage.ts'
import { copyText, createFolderFlow, deleteFolderFlow, editFolderFlow } from './actions.tsx'
import { DEEPSEEK_LOGO_DATA_URL } from '../shared/deepseekLogo.ts'
import {
  ActiveMarkerIcon, ChevronIcon, CopyMenuIcon, DeleteMenuIcon, DotsIcon,
  EditMenuIcon, FolderClosedIcon, FolderOpenIcon, MoveMenuIcon, NewSubfolderMenuIcon,
  NotepadItemIcon, PinIndicatorIcon, PinMenuIcon, UnstarMenuIcon,
} from './icons.tsx'
import css from './starred.module.css'

type T = TranslateNS<typeof NS>

/** 收藏树 props。 */
export interface StarredTreeProps {
  readonly currentSessionId: string | undefined
  readonly openSession: (sessionId: string) => void
  /** 导航后回调（面板关闭）。 */
  readonly onAfterNavigate: () => void
  /** 搜索词（小写；设置面板收藏 tab 场景，原 getSearchQuery）。 */
  readonly searchQuery?: string
  /** 搜索空态容器类（设置面板 tab 场景，原 emptyClass: 'timeline-starred-empty' 注入）。 */
  readonly searchEmptyClassName?: string
  /** 树内操作 toast 配色覆盖（原 tab 场景注入的 toastOptions.color）。 */
  readonly toastColors?: typeof FOLDER_TOAST_OPTIONS['color']
  /** 展开态使用面板独立作用域（原 tab 的 persistent folderStates，与侧栏互不影响）。 */
  readonly localExpansion?: boolean
  /** 收藏项显示平台 logo（原 showPlatformIcon：sidebar false / tab true）。 */
  readonly showPlatformIcon?: boolean
  readonly t: T
}

/** 双击判定延迟（原 DBLCLICK_DELAY）。 */
const DBLCLICK_DELAY = 250

/** 「未分类」虚拟文件夹 id（原 __default__）。 */
const DEFAULT_FOLDER_ID = '__default__'

/** 定位收藏项 toast 的配色（原 _toastAtFolder）。 */
const FOLDER_TOAST_OPTIONS = {
  position: 'right' as const,
  gap: 6,
  color: {
    light: { backgroundColor: '#0d0d0d', textColor: '#ffffff', borderColor: '#0d0d0d' },
    dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#e5e7eb' },
  },
}

/** 文件夹头部元素（拖拽指示与 toast 锚点）。 */
function headerOf(folderEl: HTMLElement): HTMLElement {
  const header = folderEl.querySelector(`:scope > .${css.folderHeader}`)
  return header instanceof HTMLElement ? header : folderEl
}

/** 设置面板场景的独立展开态（原 BaseTab persistent folderStates，内存态，与侧栏互不影响）。 */
const panelExpansionBus = new Bus<Readonly<Record<string, boolean>>>({})

/** 收藏树组件。 */
export function StarredTree({
  currentSessionId, openSession, onAfterNavigate, searchQuery = '',
  searchEmptyClassName, toastColors, localExpansion, showPlatformIcon, t,
}: StarredTreeProps) {
  const state = useSyncExternalStore(starredStore.subscribe, () => starredStore.getState())
  const ui = useSyncExternalStore(starredUiStore.subscribe, () => starredUiStore.getState())
  const panelExpansion = useSyncExternalStore(panelExpansionBus.subscribe, () => panelExpansionBus.get())
  const folderStates = localExpansion === true ? panelExpansion : ui.folderStates
  const tree = useMemo(() => starredStore.getStarredByFolder(), [state])

  // toast 配色随场景注入（原 tab 场景 toastOptions.color）；ref 供稳定回调读取。
  const toastOpts = toastColors === undefined ? FOLDER_TOAST_OPTIONS : { ...FOLDER_TOAST_OPTIONS, color: toastColors }
  const toastOptsRef = useRef(toastOpts)
  toastOptsRef.current = toastOpts

  const listRef = useRef<HTMLDivElement>(null)

  // 委托 handler 读取的最新数据（避免重绑）。
  const dataRef = useRef<{
    items: Map<string, StarItem>
    folders: Map<string, { folder: FolderNode; level: number }>
  }>({ items: new Map(), folders: new Map() })

  {
    const items = new Map<string, StarItem>()
    const folders = new Map<string, { folder: FolderNode; level: number }>()
    const walk = (list: readonly FolderNode[], level: number): void => {
      for (const f of list) {
        folders.set(f.id, { folder: f, level })
        for (const i of f.items) items.set(i.key, i)
        walk(f.children, level + 1)
      }
    }
    walk(tree.folders, 0)
    for (const i of tree.uncategorized) items.set(i.key, i)
    dataRef.current = { items, folders }
  }

  const ctxRef = useRef({ currentSessionId, openSession, onAfterNavigate, t })
  ctxRef.current = { currentSessionId, openSession, onAfterNavigate, t }

  // ==== 导航（原 _navigateToItem，URL 语义换成 sessionId） ====
  const navigateToItem = (item: StarItem): void => {
    const { currentSessionId: cur, openSession: open, onAfterNavigate: after } = ctxRef.current
    // 闪记笔记项：打开闪记面板并定位到笔记（原 notepad: 前缀分支）。
    if (item.sessionId === 'notepad') {
      notepad.openNote(item.nodeKey)
      after()
      return
    }
    const needsScroll = item.nodeKey !== '-1'
    if (item.sessionId === cur) {
      if (needsScroll) {
        const port = findScrollContainer()
        const el = findMessageElement(item.nodeKey)
        if (port !== null && el !== null) smoothScrollTo(port, el)
      }
      after()
    } else {
      if (needsScroll) pendingNavigateStore.set({ sessionId: item.sessionId, nodeKey: item.nodeKey })
      open(item.sessionId)
      after()
    }
  }

  // ==== CRUD（原 handleXxx；store 更新自动触发重渲染） ====

  const editStarred = async (item: StarItem): Promise<void> => {
    const result = await starEditModal.show({
      title: t('starred.edit'),
      defaultValue: item.question,
      defaultFolderId: item.folderId,
    })
    if (result === null || result.value.trim() === '') return
    const updates: { question?: string; folderId?: string | null } = {}
    if (result.value.trim() !== item.question) updates.question = result.value.trim()
    if (result.folderId !== item.folderId) updates.folderId = result.folderId
    if (Object.keys(updates).length > 0) {
      starredStore.updateStar(item.key, updates)
      toast.success(t('starred.updated'))
    }
  }

  const unstar = (key: string, anchorFolderEl: HTMLElement | null): void => {
    starredStore.removeStar(key)
    if (anchorFolderEl !== null) {
      toast.success(t('starred.unstarred'), headerOf(anchorFolderEl), toastOptsRef.current)
    } else {
      toast.success(t('starred.unstarred'))
    }
  }

  // ==== 菜单（原 _showFolderMenu / _showItemMenu） ====

  const showFolderMenu = (trigger: HTMLElement, folder: FolderNode, level: number): void => {
    const items: DropdownItem[] = []
    if (level === 0) {
      items.push({
        label: t('starred.newSubfolder'),
        icon: <NewSubfolderMenuIcon />,
        onClick: () => { void createFolderFlow(folder.id, t) },
      })
    }
    items.push({
      label: folder.pinned === true ? t('starred.unpin') : t('starred.pin'),
      icon: <PinMenuIcon />,
      onClick: () => { starredStore.togglePinFolder(folder.id) },
    })
    items.push({
      label: t('starred.renameFolder'),
      icon: <EditMenuIcon />,
      onClick: () => { void editFolderFlow(folder.id, folder.name, t) },
    })
    items.push({ type: 'divider' })
    items.push({
      label: t('starred.delete'),
      icon: <DeleteMenuIcon />,
      className: 'danger',
      onClick: () => { void deleteFolderFlow(folder.id, t) },
    })
    dropdown.show({ trigger, items, position: 'bottom-right', width: 160 })
  }

  const showItemMenu = (trigger: HTMLElement, item: StarItem): void => {
    const items: DropdownItem[] = [
      {
        label: item.pinned === true ? t('starred.unpin') : t('starred.pin'),
        icon: <PinMenuIcon />,
        onClick: () => { starredStore.togglePinStarred(item.key) },
      },
      {
        label: t('starred.edit'),
        icon: <EditMenuIcon />,
        onClick: () => { void editStarred(item) },
      },
      {
        label: t('starred.moveTo'),
        icon: <MoveMenuIcon />,
        onClick: () => { void editStarred(item) },
      },
      {
        label: t('starred.copy'),
        icon: <CopyMenuIcon />,
        onClick: () => { void copyText(item.question, t) },
      },
      { type: 'divider' },
      {
        label: t('starred.unstar'),
        icon: <UnstarMenuIcon />,
        className: 'danger',
        onClick: () => {
          const list = listRef.current
          let anchor: HTMLElement | null = null
          if (list !== null) {
            const el = list.querySelector(`[data-key="${CSS.escape(item.key)}"]`)
            anchor = el?.closest(`.${css.folderItem}`) ?? null
          }
          unstar(item.key, anchor)
        },
      },
    ]
    dropdown.show({ trigger, items, position: 'bottom-right', width: 160 })
  }

  // ==== 容器级事件委托 + 拖拽（原 _bindContainerDelegation） ====
  useEffect(() => {
    const container = listRef.current
    if (container === null) return
    const rootEl = container.closest('[data-dsh-starred-root]')

    let clickTimer: ReturnType<typeof setTimeout> | null = null
    let hoveredName: Element | null = null

    const itemOf = (el: Element): StarItem | undefined => {
      const key = el.closest(`.${css.item}`)?.getAttribute('data-key')
      return key === null || key === undefined ? undefined : dataRef.current.items.get(key)
    }

    const onClick = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return

      // 折叠三角：立即切换。
      const toggle = target.closest(`.${css.folderToggle}`)
      if (toggle !== null) {
        e.stopPropagation()
        const folderId = toggle.closest(`.${css.folderItem}`)?.getAttribute('data-folder-id')
        if (folderId !== null && folderId !== undefined) toggleFolder(folderId)
        return
      }

      // 文件夹信息区：单击切换（延迟让位双击编辑）。
      const info = target.closest(`.${css.folderInfo}`)
      if (info !== null) {
        const folderId = info.closest(`.${css.folderItem}`)?.getAttribute('data-folder-id')
        if (folderId !== null && folderId !== undefined) {
          if (clickTimer !== null) { clearTimeout(clickTimer); clickTimer = null }
          clickTimer = setTimeout(() => {
            clickTimer = null
            toggleFolder(folderId)
          }, DBLCLICK_DELAY)
        }
        return
      }

      // 文件夹 … 按钮。
      const actBtn = target.closest(`.${css.folderActionBtn}`)
      if (actBtn instanceof HTMLElement) {
        e.stopPropagation()
        const folderId = actBtn.closest(`.${css.folderItem}`)?.getAttribute('data-folder-id')
        if (folderId !== null && folderId !== undefined) {
          const data = dataRef.current.folders.get(folderId)
          if (data !== undefined) showFolderMenu(actBtn, data.folder, data.level)
        }
        return
      }

      // 收藏项名称：单击导航（延迟让位双击编辑）。
      if (target.closest(`.${css.itemName}`) !== null) {
        const item = itemOf(target)
        if (item !== undefined) {
          if (clickTimer !== null) { clearTimeout(clickTimer); clickTimer = null }
          clickTimer = setTimeout(() => {
            clickTimer = null
            navigateToItem(item)
          }, DBLCLICK_DELAY)
        }
        return
      }

      // 收藏项 … 按钮。
      const moreBtn = target.closest(`.${css.itemMore}`)
      if (moreBtn instanceof HTMLElement) {
        e.stopPropagation()
        const item = itemOf(moreBtn)
        if (item !== undefined) showItemMenu(moreBtn, item)
      }
    }

    const onDblClick = (e: MouseEvent): void => {
      if (clickTimer !== null) { clearTimeout(clickTimer); clickTimer = null }
      const target = e.target
      if (!(target instanceof Element)) return

      const info = target.closest(`.${css.folderInfo}`)
      if (info !== null) {
        const folderEl = info.closest(`.${css.folderItem}`)
        if (folderEl !== null && !folderEl.classList.contains(css.defaultFolder)) {
          const folderId = folderEl.getAttribute('data-folder-id')
          const data = folderId !== null ? dataRef.current.folders.get(folderId) : undefined
          if (data !== undefined) void editFolderFlow(data.folder.id, data.folder.name, ctxRef.current.t)
        }
        return
      }

      if (target.closest(`.${css.itemName}`) !== null) {
        const item = itemOf(target)
        if (item !== undefined) void editStarred(item)
      }
    }

    // 名称溢出 tooltip（原 onMouseover/onMouseout）。
    const onMouseover = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return
      const name = target.closest(`.${css.itemName}`)
      if (name === hoveredName) return
      if (hoveredName !== null) { tooltip.hide(); hoveredName = null }
      if (name === null || name.scrollWidth <= name.clientWidth) return
      const item = itemOf(name)
      if (item === undefined) return
      hoveredName = name
      const itemEl = name.closest(`.${css.item}`)
      if (itemEl instanceof HTMLElement) {
        tooltip.show('starred-item-name', itemEl, item.question, { placement: 'right' })
      }
    }

    const onMouseout = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return
      const name = target.closest(`.${css.itemName}`)
      if (name !== null && !(e.relatedTarget instanceof Node && name.contains(e.relatedTarget))) {
        hoveredName = null
        tooltip.hide()
      }
    }

    // ---- 拖拽指示 ----
    let dropTarget: HTMLElement | null = null
    let dropPosition: 'inside' | 'before' | 'after' | null = null
    let dropItemTarget: HTMLElement | null = null
    let dropItemPosition: 'before' | 'after' | null = null

    const clearDropIndicator = (): void => {
      if (dropTarget !== null) {
        dropTarget.classList.remove(css.dragOver, css.dropBefore, css.dropAfter)
        dropTarget = null
        dropPosition = null
      }
    }
    const setDropIndicator = (folderEl: HTMLElement, position: 'inside' | 'before' | 'after'): void => {
      if (dropTarget === folderEl && dropPosition === position) return
      clearDropIndicator()
      dropTarget = folderEl
      dropPosition = position
      if (position === 'inside') folderEl.classList.add(css.dragOver)
      else if (position === 'before') folderEl.classList.add(css.dropBefore)
      else folderEl.classList.add(css.dropAfter)
    }
    const clearItemDropIndicator = (): void => {
      if (dropItemTarget !== null) {
        dropItemTarget.classList.remove(css.itemDropBefore, css.itemDropAfter)
        dropItemTarget = null
        dropItemPosition = null
      }
    }
    const setItemDropIndicator = (itemEl: HTMLElement, position: 'before' | 'after'): void => {
      if (dropItemTarget === itemEl && dropItemPosition === position) return
      clearItemDropIndicator()
      dropItemTarget = itemEl
      dropItemPosition = position
      itemEl.classList.add(position === 'before' ? css.itemDropBefore : css.itemDropAfter)
    }

    /** 拖拽悬停检测（原 _detectDropTarget）。 */
    const detectDropTarget = (clientX: number, clientY: number, sourceKey: string): (
      | { type: 'item'; itemEl: HTMLElement; folderEl: HTMLElement; key: string; folderId: string; position: 'before' | 'after' }
      | { type: 'folder'; folderEl: HTMLElement; folderId: string }
      | null
    ) => {
      const el = document.elementFromPoint(clientX, clientY)
      if (el === null) return null
      const itemEl = el.closest(`.${css.item}`)
      if (itemEl instanceof HTMLElement && itemEl.getAttribute('data-key') !== sourceKey) {
        const folderEl = itemEl.closest(`.${css.folderItem}`)
        if (folderEl instanceof HTMLElement) {
          const rect = itemEl.getBoundingClientRect()
          return {
            type: 'item',
            itemEl,
            folderEl,
            key: itemEl.getAttribute('data-key') ?? '',
            folderId: folderEl.getAttribute('data-folder-id') ?? '',
            position: clientY < rect.top + rect.height / 2 ? 'before' : 'after',
          }
        }
      }
      const folderEl = el.closest(`.${css.folderItem}`)
      if (folderEl instanceof HTMLElement) {
        return { type: 'folder', folderEl, folderId: folderEl.getAttribute('data-folder-id') ?? '' }
      }
      return null
    }

    // ---- 收藏项自定义鼠标拖拽（原 onItemMouseDown/Move/Up） ----
    interface ItemDrag {
      startX: number
      startY: number
      key: string
      sourceFolderId: string | null
      sourceEl: HTMLElement
      title: string
      active: boolean
      ghost: HTMLElement | null
    }
    let itemDrag: ItemDrag | null = null

    const itemDragCleanup = (): void => {
      if (itemDrag === null) return
      rootEl?.removeAttribute('data-dragging')
      itemDrag.sourceEl.style.opacity = ''
      itemDrag.sourceEl.style.transition = ''
      itemDrag.ghost?.remove()
      clearDropIndicator()
      clearItemDropIndicator()
      itemDrag = null
    }

    const onItemMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const target = e.target
      if (!(target instanceof Element)) return
      if (target.closest(`.${css.itemMore}`) !== null || target.closest(`.${css.itemActions}`) !== null) return
      const itemEl = target.closest(`.${css.item}`)
      if (!(itemEl instanceof HTMLElement)) return
      const key = itemEl.getAttribute('data-key')
      if (key === null) return
      const item = dataRef.current.items.get(key)
      if (item === undefined) return
      itemDrag = {
        startX: e.clientX,
        startY: e.clientY,
        key,
        sourceFolderId: item.folderId,
        sourceEl: itemEl,
        title: item.question,
        active: false,
        ghost: null,
      }
    }

    const onItemMouseMove = (e: MouseEvent): void => {
      if (itemDrag === null) return
      if (!itemDrag.active) {
        if (Math.abs(e.clientX - itemDrag.startX) < 5 && Math.abs(e.clientY - itemDrag.startY) < 5) return
        itemDrag.active = true
        rootEl?.setAttribute('data-dragging', 'true')
        itemDrag.sourceEl.style.opacity = '0.35'
        itemDrag.sourceEl.style.transition = 'opacity 0.15s'
        const ghost = document.createElement('div')
        ghost.className = css.dragGhost
        ghost.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
        const span = document.createElement('span')
        span.textContent = itemDrag.title !== '' ? itemDrag.title : 'Item'
        ghost.appendChild(span)
        ;(rootEl ?? document.body).appendChild(ghost)
        itemDrag.ghost = ghost
      }
      if (itemDrag.ghost !== null) {
        itemDrag.ghost.style.left = `${e.clientX + 14}px`
        itemDrag.ghost.style.top = `${e.clientY - 16}px`
      }
      const target = detectDropTarget(e.clientX, e.clientY, itemDrag.key)
      clearDropIndicator()
      clearItemDropIndicator()
      if (target?.type === 'item') {
        setItemDropIndicator(target.itemEl, target.position)
        const targetFid = target.folderId === DEFAULT_FOLDER_ID ? null : target.folderId
        if (targetFid !== itemDrag.sourceFolderId) setDropIndicator(target.folderEl, 'inside')
      } else if (target?.type === 'folder') {
        const actualId = target.folderId === DEFAULT_FOLDER_ID ? null : target.folderId
        if (actualId !== itemDrag.sourceFolderId) setDropIndicator(target.folderEl, 'inside')
      }
    }

    const onItemMouseUp = (e: MouseEvent): void => {
      if (itemDrag === null) return
      if (itemDrag.active) {
        const target = detectDropTarget(e.clientX, e.clientY, itemDrag.key)
        if (target?.type === 'item') {
          const actualFid = target.folderId === DEFAULT_FOLDER_ID ? null : target.folderId
          const draggedKey = itemDrag.key
          // 拖拽自动置顶：落点参考项的 pinned 状态即目标区域（原 _inferPinFromDrop）。
          const refItem = dataRef.current.items.get(target.key)
          const shouldPin = refItem?.pinned === true
          const current = dataRef.current.items.get(draggedKey)
          const needsPinChange = current !== undefined && (current.pinned === true) !== shouldPin
          starredStore.reorderStarredInFolder(draggedKey, actualFid, target.key, target.position)
          if (needsPinChange) starredStore.updateStar(draggedKey, { pinned: shouldPin })
          toast.success(ctxRef.current.t('starred.moved'), headerOf(target.folderEl), toastOptsRef.current)
        } else if (target?.type === 'folder') {
          const actualId = target.folderId === DEFAULT_FOLDER_ID ? null : target.folderId
          if (actualId !== itemDrag.sourceFolderId) {
            starredStore.moveStarredToFolder(itemDrag.key, actualId)
            toast.success(ctxRef.current.t('starred.moved'), headerOf(target.folderEl), toastOptsRef.current)
          }
        } else {
          // 拖出面板边界：取消收藏（原 boundary 检测：侧栏浮层为 .panel，
          // 设置面板收藏 Tab 为标记容器，对应原 .starred-tab-container）。
          const boundary = container.closest(`.${css.panel}`)
            ?? container.closest('[data-dsh-starred-boundary]')
            ?? container
          const rect = boundary.getBoundingClientRect()
          const outside = e.clientX < rect.left || e.clientX > rect.right
            || e.clientY < rect.top || e.clientY > rect.bottom
          if (outside) {
            const fid = itemDrag.sourceFolderId ?? DEFAULT_FOLDER_ID
            const folderEl = container.querySelector(`[data-folder-id="${CSS.escape(fid)}"]`)
            const key = itemDrag.key
            itemDragCleanup()
            unstar(key, folderEl instanceof HTMLElement ? folderEl : null)
            return
          }
        }
      }
      itemDragCleanup()
    }

    const onItemKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && itemDrag?.active === true) itemDragCleanup()
    }

    // ---- 文件夹 HTML5 拖拽（原 onDragStart/Over/Drop/End） ----
    interface FolderDrag {
      id: string
      sourceLevel: number
      sourceParentId: string | null
      element: HTMLElement
    }
    let folderDrag: FolderDrag | null = null

    const folderDragCleanup = (): void => {
      folderDrag?.element.classList.remove(css.dragging)
      folderDrag = null
      clearDropIndicator()
    }

    const onDragStart = (e: DragEvent): void => {
      if (itemDrag !== null) { e.preventDefault(); return }
      const target = e.target
      if (!(target instanceof Element)) return
      const headerEl = target.closest(`.${css.folderHeader}`)
      if (headerEl === null) return
      const folderEl = headerEl.closest(`.${css.folderItem}`)
      if (!(folderEl instanceof HTMLElement) || folderEl.classList.contains(css.defaultFolder)) {
        e.preventDefault()
        return
      }
      const folderId = folderEl.getAttribute('data-folder-id')
      const data = folderId !== null ? dataRef.current.folders.get(folderId) : undefined
      if (folderId === null || data === undefined) { e.preventDefault(); return }
      folderDrag = {
        id: folderId,
        sourceLevel: data.level,
        sourceParentId: data.folder.parentId,
        element: folderEl,
      }
      if (e.dataTransfer !== null) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', folderId)
      }
      requestAnimationFrame(() => { folderEl.classList.add(css.dragging) })
    }

    const onDragOver = (e: DragEvent): void => {
      if (folderDrag === null) return
      const target = e.target
      const folderEl = target instanceof Element ? target.closest(`.${css.folderItem}`) : null
      if (!(folderEl instanceof HTMLElement)) { clearDropIndicator(); return }

      const targetFolderId = folderEl.getAttribute('data-folder-id') ?? ''
      if (targetFolderId === folderDrag.id || targetFolderId === DEFAULT_FOLDER_ID) {
        clearDropIndicator()
        return
      }
      const targetData = dataRef.current.folders.get(targetFolderId)
      if (targetData === undefined) { clearDropIndicator(); return }

      const sameParent = targetData.level === folderDrag.sourceLevel
        && targetData.folder.parentId === folderDrag.sourceParentId

      if (sameParent) {
        e.preventDefault()
        if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move'
        const rect = headerOf(folderEl).getBoundingClientRect()
        setDropIndicator(folderEl, e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      } else if (targetData.level === 0 && targetFolderId !== folderDrag.sourceParentId) {
        e.preventDefault()
        if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move'
        setDropIndicator(folderEl, 'inside')
      } else {
        clearDropIndicator()
      }
    }

    const onDrop = (e: DragEvent): void => {
      if (folderDrag === null) return
      e.preventDefault()
      const target = e.target
      const folderEl = target instanceof Element ? target.closest(`.${css.folderItem}`) : null
      if (!(folderEl instanceof HTMLElement)) { folderDragCleanup(); return }

      const targetFolderId = folderEl.getAttribute('data-folder-id') ?? ''
      if (targetFolderId === folderDrag.id || targetFolderId === DEFAULT_FOLDER_ID) {
        folderDragCleanup()
        return
      }
      const position = dropPosition
      const tt = ctxRef.current.t
      if (position === 'inside') {
        const result = starredStore.moveFolderToParent(folderDrag.id, targetFolderId)
        if (result.ok) {
          toast.success(tt('starred.moved'), headerOf(folderEl), toastOptsRef.current)
        } else if (result.error === 'hasChildren') {
          toast.error(tt('starred.moveHasChildren'))
        } else if (result.error === 'maxDepth') {
          toast.error(tt('starred.moveMaxDepth'))
        }
      } else if (position === 'before' || position === 'after') {
        starredStore.moveFolderToPosition(folderDrag.id, targetFolderId, position)
        toast.success(tt('starred.moved'), headerOf(folderEl), toastOptsRef.current)
      }
      folderDragCleanup()
    }

    const onDragEnd = (): void => { folderDragCleanup() }

    container.addEventListener('click', onClick)
    container.addEventListener('dblclick', onDblClick)
    container.addEventListener('mouseover', onMouseover)
    container.addEventListener('mouseout', onMouseout)
    container.addEventListener('mousedown', onItemMouseDown, true)
    container.addEventListener('dragstart', onDragStart)
    container.addEventListener('dragover', onDragOver)
    container.addEventListener('drop', onDrop)
    container.addEventListener('dragend', onDragEnd)
    document.addEventListener('mousemove', onItemMouseMove)
    document.addEventListener('mouseup', onItemMouseUp)
    document.addEventListener('keydown', onItemKeyDown)

    return () => {
      container.removeEventListener('click', onClick)
      container.removeEventListener('dblclick', onDblClick)
      container.removeEventListener('mouseover', onMouseover)
      container.removeEventListener('mouseout', onMouseout)
      container.removeEventListener('mousedown', onItemMouseDown, true)
      container.removeEventListener('dragstart', onDragStart)
      container.removeEventListener('dragover', onDragOver)
      container.removeEventListener('drop', onDrop)
      container.removeEventListener('dragend', onDragEnd)
      document.removeEventListener('mousemove', onItemMouseMove)
      document.removeEventListener('mouseup', onItemMouseUp)
      document.removeEventListener('keydown', onItemKeyDown)
      if (clickTimer !== null) clearTimeout(clickTimer)
      itemDragCleanup()
      folderDragCleanup()
    }
    // 委托 handler 通过 ref 读最新数据，仅随容器挂载绑定一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleFolder = (folderId: string): void => {
    const states = localExpansion === true ? panelExpansionBus.get() : starredUiStore.getState().folderStates
    const expanded = folderId === DEFAULT_FOLDER_ID
      ? states[folderId] !== false
      : states[folderId] === true
    if (localExpansion === true) {
      panelExpansionBus.set({ ...panelExpansionBus.get(), [folderId]: !expanded })
    } else {
      starredUiStore.setFolderState(folderId, !expanded)
    }
  }

  // ==== 渲染 ====

  const renderItem = (item: StarItem): React.ReactNode => {
    const isNotepad = item.sessionId === 'notepad'
    const isNodeLevel = !isNotepad && item.nodeKey !== '-1'
    const isActive = !isNotepad && item.sessionId === currentSessionId
    // 原 renderStarredItem：闪记项固定铅笔图标；普通项仅 tab 场景显示平台 logo，
    // sidebar 场景不显示图标。
    const logo = isNotepad
      ? <div className={css.itemLogo}><NotepadItemIcon /></div>
      : (showPlatformIcon === true
          ? <div className={css.itemLogo}><img src={DEEPSEEK_LOGO_DATA_URL} alt="DeepSeek" /></div>
          : null)
    return (
      <div
        key={item.key}
        className={[
          css.item,
          isNodeLevel ? css.itemNode : '',
          isActive ? css.itemActive : '',
        ].filter(Boolean).join(' ')}
        data-key={item.key}
      >
        {logo}
        {isNodeLevel
          ? <span className={css.itemActiveMarker}><ActiveMarkerIcon /></span>
          : null}
        <div className={css.itemName}>{item.question}</div>
        <div className={css.itemActions}>
          {item.pinned === true
            ? <span className={css.pinIndicator}><PinIndicatorIcon /></span>
            : null}
          <button type="button" className={css.itemMore} aria-label="more">
            <DotsIcon />
          </button>
        </div>
      </div>
    )
  }

  // 搜索匹配（原 _matchesSearch：仅匹配收藏项主题）。
  const matchesSearch = (item: StarItem): boolean =>
    searchQuery === '' || item.question.toLowerCase().includes(searchQuery)

  const renderFolder = (folder: FolderNode, level: number): React.ReactNode => {
    // 原 renderFolder 搜索分支：文件夹名命中显示全部项；否则过滤项，
    // 名称/项/子级均不命中时整个文件夹隐藏；搜索中强制展开。
    let visibleItems = folder.items
    if (searchQuery !== '') {
      const folderNameMatches = folder.name.toLowerCase().includes(searchQuery)
      const filteredItems = folderNameMatches ? folder.items : folder.items.filter(matchesSearch)
      const hasMatchingChildren = folder.children.some((child) => {
        const childNameMatches = child.name.toLowerCase().includes(searchQuery)
        const childHasItems = child.items.some(matchesSearch)
        return childNameMatches || childHasItems
      })
      if (!folderNameMatches && filteredItems.length === 0 && !hasMatchingChildren) return null
      visibleItems = filteredItems
    }
    const expanded = searchQuery !== '' ? true : folderStates[folder.id] === true
    return (
      <div
        key={folder.id}
        className={css.folderItem}
        data-folder-id={folder.id}
        data-level={level}
      >
        <div className={css.folderHeader} draggable>
          <span className={expanded ? `${css.folderToggle} ${css.folderToggleExpanded}` : css.folderToggle}>
            <ChevronIcon />
          </span>
          <div className={css.folderInfo}>
            <span className={css.folderIcon}>
              {folder.icon !== ''
                ? folder.icon
                : (expanded
                    ? <FolderOpenIcon gradientId={`fo-${folder.id}`} />
                    : <FolderClosedIcon gradientId={`fc-${folder.id}`} />)}
            </span>
            <span className={css.folderName}>{folder.name}</span>
          </div>
          <div className={css.folderActions}>
            {folder.pinned === true
              ? <span className={css.pinIndicator}><PinIndicatorIcon /></span>
              : null}
            <button type="button" className={css.folderActionBtn} aria-label="actions">
              <DotsIcon />
            </button>
          </div>
        </div>
        <div className={expanded ? `${css.folderContent} ${css.folderContentExpanded}` : css.folderContent}>
          {folder.children.map(child => renderFolder(child, level + 1))}
          {visibleItems.map(item => renderItem(item))}
        </div>
      </div>
    )
  }

  const renderDefaultFolder = (allItems: readonly StarItem[]): React.ReactNode => {
    // 原 _renderDefaultFolder：搜索时过滤项，无命中则隐藏；搜索中强制展开。
    const items = searchQuery !== '' ? allItems.filter(matchesSearch) : allItems
    if (items.length === 0) return null
    const expanded = searchQuery !== '' ? true : folderStates[DEFAULT_FOLDER_ID] !== false
    return (
      <div
        key={DEFAULT_FOLDER_ID}
        className={`${css.folderItem} ${css.defaultFolder}`}
        data-folder-id={DEFAULT_FOLDER_ID}
        data-level={0}
      >
        <div className={css.folderHeader}>
          <span className={expanded ? `${css.folderToggle} ${css.folderToggleExpanded}` : css.folderToggle}>
            <ChevronIcon />
          </span>
          <div className={css.folderInfo}>
            <span className={css.folderIcon}>
              {expanded
                ? <FolderOpenIcon gradientId="fo-default" />
                : <FolderClosedIcon gradientId="fc-default" />}
            </span>
            <span className={css.folderName}>{t('starred.defaultFolder')}</span>
          </div>
        </div>
        <div className={expanded ? `${css.folderContent} ${css.folderContentExpanded}` : css.folderContent}>
          {items.map(item => renderItem(item))}
        </div>
      </div>
    )
  }

  const isEmpty = tree.folders.length === 0 && tree.uncategorized.length === 0

  // 搜索后无任何命中（原 renderTree 尾部的搜索空态）。
  const searchEmpty = searchQuery !== '' && !isEmpty
    && !tree.uncategorized.some(matchesSearch)
    && !tree.folders.some((folder) => {
      if (folder.name.toLowerCase().includes(searchQuery)) return true
      if (folder.items.some(matchesSearch)) return true
      return folder.children.some(child =>
        child.name.toLowerCase().includes(searchQuery) || child.items.some(matchesSearch))
    })

  return (
    <div ref={listRef} className={css.list}>
      {isEmpty
        ? <div className={css.empty}>{t('starred.empty')}</div>
        : searchEmpty
          ? (
            <div className={searchEmptyClassName ?? css.empty}>
              <div style={{ marginBottom: 8 }}>{t('panel.starredSearchEmpty')}</div>
              <div style={{ fontSize: 13, color: '#9ca3af' }}>
                {t('panel.starredSearchKeyword')}
                <strong>{`"${searchQuery}"`}</strong>
              </div>
            </div>
          )
          : (
            <>
              {tree.folders.map(folder => renderFolder(folder, 0))}
              {renderDefaultFolder(tree.uncategorized)}
            </>
          )}
    </div>
  )
}
