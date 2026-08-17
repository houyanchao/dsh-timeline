/**
 * 全局下拉菜单：移植原扩展 GlobalDropdownManager。
 * - 智能定位（bottom-left 等四方位 + 视口边界翻转/修正）；
 * - 透明遮罩阻挡下层点击；点击外部/滚动/resize 关闭；
 * - 菜单项：图标（ReactNode）、分割线、禁用、danger / create-action 变体；
 * - 子菜单：hover 展开、最多三级、右侧优先左侧回退、mouseleave 分层关闭。
 * 命令式 API（dropdown.show）+ React 宿主（DropdownHost，挂 shell.overlay）。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Bus } from './bus.ts'
import css from './ui.module.css'

/** 菜单项（原 items 元素；icon 从 HTML 字符串改为 ReactNode）。 */
export interface DropdownItem {
  readonly type?: 'divider'
  readonly label?: string
  readonly icon?: ReactNode
  readonly disabled?: boolean
  /** 变体：danger（红）/ create-action（斜体弱化 + 品牌紫图标）。 */
  readonly className?: 'danger' | 'create-action'
  readonly children?: readonly DropdownItem[]
  readonly onClick?: (item: DropdownItem) => void
}

/** show 配置（与原版对齐）。 */
export interface DropdownShowOptions {
  readonly trigger: HTMLElement
  readonly items: readonly DropdownItem[]
  readonly onSelect?: (item: DropdownItem) => void
  readonly position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
  readonly width?: number
  /** 附加到主菜单容器的自定义样式类（原 config.className）。 */
  readonly className?: string
  readonly id?: string
}

interface DropdownState extends DropdownShowOptions {
  readonly id: string
  /** 每次 show 递增，保证重开时实例重建重定位。 */
  readonly seq: number
  /** 退出动画中。 */
  readonly closing: boolean
}

const bus = new Bus<DropdownState | null>(null)
let hideAnimTimer: ReturnType<typeof setTimeout> | null = null
let showSeq = 0

/** 命令式 Dropdown API（等价原 window.globalDropdownManager）。 */
export const dropdown = {
  show(options: DropdownShowOptions): void {
    if (!options.trigger.isConnected || options.items.length === 0) return
    const id = options.id ?? `dropdown-${Date.now()}`
    const current = bus.get()
    if (current !== null && !current.closing && current.id === id) return
    // 快速切换：立即移除旧菜单。
    if (hideAnimTimer !== null) { clearTimeout(hideAnimTimer); hideAnimTimer = null }
    showSeq += 1
    bus.set({ ...options, id, seq: showSeq, closing: false })
  },
  hide(immediate = false): void {
    const current = bus.get()
    if (current === null) return
    if (hideAnimTimer !== null) { clearTimeout(hideAnimTimer); hideAnimTimer = null }
    if (immediate) {
      bus.set(null)
      return
    }
    bus.set({ ...current, closing: true })
    hideAnimTimer = setTimeout(() => {
      hideAnimTimer = null
      bus.set(null)
    }, 150)
  },
  forceHideAll(): void {
    if (hideAnimTimer !== null) { clearTimeout(hideAnimTimer); hideAnimTimer = null }
    bus.set(null)
  },
  isVisible(): boolean {
    const s = bus.get()
    return s !== null && !s.closing
  },
}

/** 已展开的子菜单（level 从 1 开始）。 */
interface OpenSubmenu {
  /** 实例唯一 key（淡出中的与新开的同级子菜单并存时区分）。 */
  readonly key: number
  readonly level: number
  readonly parentItem: DropdownItem
  readonly parentEl: HTMLElement
  /** 淡出中（原 _hideSubmenusFromLevel 的 200ms 退出动画）。 */
  readonly closing: boolean
}

let submenuKeySeq = 0

const CONFIG = { defaultWidth: 200, gap: 8, padding: 8 } as const

/** 主菜单定位（移植 _calculatePosition）。 */
function calcMenuPosition(
  trigger: HTMLElement,
  menuRect: DOMRect,
  preferred: string,
): { left: number; top: number; placement: string } {
  const triggerRect = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = CONFIG.gap
  const padding = CONFIG.padding

  let left: number
  let top: number
  let placement = preferred
  switch (preferred) {
    case 'bottom-right':
      left = triggerRect.right - menuRect.width
      top = triggerRect.bottom + gap
      break
    case 'top-left':
      left = triggerRect.left
      top = triggerRect.top - menuRect.height - gap
      break
    case 'top-right':
      left = triggerRect.right - menuRect.width
      top = triggerRect.top - menuRect.height - gap
      break
    default:
      left = triggerRect.left
      top = triggerRect.bottom + gap
      placement = 'bottom-left'
  }

  if (left < padding) left = padding
  else if (left + menuRect.width > vw - padding) left = vw - menuRect.width - padding

  if (top + menuRect.height > vh - padding) {
    const topPos = triggerRect.top - menuRect.height - gap
    if (topPos >= padding) {
      top = topPos
      placement = placement.replace('bottom', 'top')
    } else {
      top = vh - menuRect.height - padding
    }
  }
  if (top < padding) {
    const bottomPos = triggerRect.bottom + gap
    if (bottomPos + menuRect.height <= vh - padding) {
      top = bottomPos
      placement = placement.replace('top', 'bottom')
    } else {
      top = padding
    }
  }
  return { left: Math.round(left), top: Math.round(top), placement }
}

/** 子菜单定位（移植 _calculateSubmenuPosition：右侧优先、顶对齐、边界回退）。 */
function calcSubmenuPosition(parentEl: HTMLElement, menuRect: DOMRect): { left: number; top: number } {
  const parentRect = parentEl.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 7
  let left: number
  if (parentRect.right + gap + menuRect.width <= vw - 10) {
    left = parentRect.right + gap
  } else {
    left = parentRect.left - menuRect.width - gap
  }
  let top = parentRect.top
  if (top + menuRect.height > vh - 10) top = vh - menuRect.height - 10
  top = Math.max(10, top)
  return { left, top }
}

/** 子菜单操作集（由 DropdownInstance 提供）。 */
interface SubmenuActions {
  /** 展开子菜单（原 _showSubmenu：含同项去重 + 关闭同级及更深）。 */
  readonly open: (item: DropdownItem, parentEl: HTMLElement, parentLevel: number) => void
  /** 淡出关闭 >= fromLevel 的子菜单（原 _hideSubmenusFromLevel：200ms 退出动画）。 */
  readonly closeFrom: (fromLevel: number) => void
  /** 立即关闭全部子菜单（原 _hideAllSubmenus(true)）。 */
  readonly closeAllImmediate: () => void
}

/** 单个菜单面板（主菜单与子菜单共用）。 */
function MenuPanel({
  state, items, level, submenus, actions, width, className, submenuInfo,
}: {
  readonly state: DropdownState
  readonly items: readonly DropdownItem[]
  readonly level: number
  readonly submenus: readonly OpenSubmenu[]
  readonly actions: SubmenuActions
  readonly width: number
  readonly className?: string
  /** level>0 时对应的子菜单实例（定位锚点 + closing 态）。 */
  readonly submenuInfo?: OpenSubmenu
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closing = submenuInfo?.closing === true

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    if (level === 0) {
      const pos = calcMenuPosition(state.trigger, rect, state.position ?? 'bottom-left')
      el.style.left = `${pos.left}px`
      el.style.top = `${pos.top}px`
      el.setAttribute('data-placement', pos.placement)
    } else {
      if (submenuInfo === undefined) return
      const pos = calcSubmenuPosition(submenuInfo.parentEl, rect)
      el.style.left = `${pos.left}px`
      el.style.top = `${pos.top}px`
    }
    requestAnimationFrame(() => { el.classList.add(css.dropdownVisible) })
    // 首次挂载即定位；level/parent 不会中途变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 子菜单淡出：移除 visible 类触发 0.2s 过渡（原 _hideSubmenusFromLevel）。
  useEffect(() => {
    if (closing) ref.current?.classList.remove(css.dropdownVisible)
  }, [closing])

  const onPanelLeave = (e: React.MouseEvent): void => {
    const related = e.relatedTarget
    if (level === 0) {
      // 主菜单：移入子菜单或遮罩（间隙）保持，否则立即关全部子菜单（原版）。
      if (related instanceof Element) {
        const menu = related.closest('[data-dsh-dropdown-level]')
        if (menu !== null && menu.getAttribute('data-dsh-dropdown-level') !== '0') return
        if (related.closest('[data-dsh-dropdown-overlay]') !== null) return
      }
      actions.closeAllImmediate()
      return
    }
    // 子菜单：移入主菜单或同级/更深子菜单保持；否则淡出关闭自身层级及更深（原版）。
    if (related instanceof Element) {
      const menu = related.closest('[data-dsh-dropdown-level]')
      if (menu !== null) {
        const targetLevel = Number(menu.getAttribute('data-dsh-dropdown-level'))
        if (targetLevel === 0 || targetLevel >= level) return
      }
    }
    actions.closeFrom(level)
  }

  return (
    <div
      ref={ref}
      className={[
        css.dropdown,
        level > 0 ? css.dropdownSubmenu : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      data-dsh-dropdown-level={level}
      style={{
        // 原版仅主菜单设置宽度，子菜单按内容自适应。
        ...(level === 0 ? { width: `${width}px` } : {}),
        ...(state.closing ? { opacity: 0, transform: 'translateY(-8px)' } : {}),
      }}
      onMouseLeave={onPanelLeave}
    >
      {items.map((item, index) => {
        if (item.type === 'divider') {
          return <div key={`div-${index}`} className={css.dropdownDivider} />
        }
        const hasSubmenu = item.children !== undefined && item.children.length > 0
        const isSubActive = submenus.some(s => s.level === level + 1 && s.parentItem === item && !s.closing)
        return (
          <div
            key={`item-${index}`}
            className={[
              css.dropdownItem,
              item.disabled === true ? css.dropdownItemDisabled : '',
              item.className === 'danger' ? css.dropdownItemDanger : '',
              item.className === 'create-action' ? css.dropdownItemCreate : '',
              hasSubmenu ? css.dropdownItemHasSub : '',
              isSubActive ? css.dropdownItemSubActive : '',
            ].filter(Boolean).join(' ')}
            onMouseEnter={(e) => {
              if (item.disabled === true) return
              if (hasSubmenu) {
                actions.open(item, e.currentTarget, level)
              } else {
                actions.closeFrom(level + 1)
              }
            }}
            onClick={(e) => {
              if (item.disabled === true) return
              e.stopPropagation()
              item.onClick?.(item)
              // 原版仅主菜单项触发全局 onSelect（子菜单项创建时 onSelect 传 null）。
              if (level === 0) state.onSelect?.(item)
              dropdown.hide()
            }}
          >
            {item.icon !== undefined ? <span className={css.dropdownItemIcon}>{item.icon}</span> : null}
            <span className={css.dropdownItemLabel}>{item.label}</span>
            {hasSubmenu ? <span className={css.dropdownItemArrow}>›</span> : null}
          </div>
        )
      })}
    </div>
  )
}

/** 单次打开的菜单实例（key=id:seq 隔离，子菜单状态随实例重建）。 */
function DropdownInstance({ state }: { readonly state: DropdownState }) {
  // 子菜单状态经 ref 镜像同步读取（open/close 需要基于最新值判定）。
  const submenusRef = useRef<readonly OpenSubmenu[]>([])
  const [submenus, setSubmenusState] = useState<readonly OpenSubmenu[]>([])
  const fadeTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  const commit = (next: readonly OpenSubmenu[]): void => {
    submenusRef.current = next
    setSubmenusState(next)
  }

  /** 淡出关闭 >= fromLevel 的子菜单（200ms 后移除，原 _hideSubmenusFromLevel）。 */
  const closeFrom = (fromLevel: number): void => {
    const targets = submenusRef.current.filter(s => s.level >= fromLevel && !s.closing)
    if (targets.length === 0) return
    const keys = new Set(targets.map(t => t.key))
    commit(submenusRef.current.map(s => (keys.has(s.key) ? { ...s, closing: true } : s)))
    const timer = setTimeout(() => {
      fadeTimersRef.current.delete(timer)
      commit(submenusRef.current.filter(s => !keys.has(s.key)))
    }, 200)
    fadeTimersRef.current.add(timer)
  }

  /** 立即关闭全部子菜单（原 _hideAllSubmenus(true)）。 */
  const closeAllImmediate = (): void => {
    for (const timer of fadeTimersRef.current) clearTimeout(timer)
    fadeTimersRef.current.clear()
    if (submenusRef.current.length > 0) commit([])
  }

  /** 展开子菜单（原 _showSubmenu）。 */
  const open = (item: DropdownItem, parentEl: HTMLElement, parentLevel: number): void => {
    const submenuLevel = parentLevel + 1
    // 最大层级限制：3 级（0=主菜单, 1=二级, 2=三级）。
    if (submenuLevel > 2) return
    if (submenusRef.current.some(s => s.level === submenuLevel && s.parentItem === item && !s.closing)) return
    closeFrom(submenuLevel)
    submenuKeySeq += 1
    commit([...submenusRef.current, {
      key: submenuKeySeq,
      level: submenuLevel,
      parentItem: item,
      parentEl,
      closing: false,
    }])
  }

  const actions: SubmenuActions = { open, closeFrom, closeAllImmediate }

  // 菜单整体关闭时立即清掉子菜单（原 hide() 的 _hideAllSubmenus(true)）。
  useEffect(() => {
    if (state.closing) closeAllImmediate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.closing])

  // 卸载时清理淡出定时器。
  useEffect(() => () => {
    for (const timer of fadeTimersRef.current) clearTimeout(timer)
    fadeTimersRef.current.clear()
  }, [])

  // 全局关闭：点击外部 / 滚动 / resize（移植 _setupGlobalListeners）。
  useEffect(() => {
    if (state.closing) return
    const onClick = (e: MouseEvent): void => {
      const t = e.target
      if (t instanceof Element && t.closest('[data-dsh-dropdown-level]') !== null) return
      // 点击 trigger（toggle 行为）或外部区域：关闭。
      dropdown.hide()
    }
    const onScroll = (e: Event): void => {
      const t = e.target
      if (t instanceof Element && t.closest('[data-dsh-dropdown-level]') !== null) return
      dropdown.hide()
    }
    const onResize = (): void => { dropdown.hide() }
    document.addEventListener('click', onClick, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [state])

  const width = state.width ?? CONFIG.defaultWidth

  return (
    <>
      <div
        className={css.dropdownOverlay}
        data-dsh-dropdown-overlay=""
        onMouseLeave={(e) => {
          // 移入任意菜单保持；移出菜单区域立即关全部子菜单（原版遮罩 mouseleave）。
          const related = e.relatedTarget
          if (related instanceof Element && related.closest('[data-dsh-dropdown-level]') !== null) return
          closeAllImmediate()
        }}
      />
      <MenuPanel
        state={state}
        items={state.items}
        level={0}
        submenus={submenus}
        actions={actions}
        width={width}
        className={state.className}
      />
      {submenus.map((s) => {
        const children = s.parentItem.children ?? []
        return (
          <MenuPanel
            key={`sub-${s.key}`}
            state={state}
            items={children}
            level={s.level}
            submenus={submenus}
            actions={actions}
            width={width}
            submenuInfo={s}
          />
        )
      })}
    </>
  )
}

/**
 * Dropdown 宿主。
 * @returns 遮罩 + 主菜单 + 已展开的子菜单链。
 */
export function DropdownHost() {
  const state = useSyncExternalStore(bus.subscribe, () => bus.get())
  if (state === null) return null
  // key 含 seq：退出动画期间重开同 id 菜单时实例重建、重新定位（原版每次 show 重建 DOM）。
  return <DropdownInstance key={`${state.id}:${String(state.seq)}`} state={state} />
}
