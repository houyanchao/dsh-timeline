/**
 * 侧栏「工作区」上方的内联文件夹列表。
 * 宿主没有 region 前置槽位：把节点插到 [data-slot="sidebar.workspaces"]
 * 前面（该槽位 display:contents，工作区根是 regionArea 的 flex 子项）。
 * 由 StarredPanel 挂载；侧栏收起时不展示。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { starredUiStore } from './storage.ts'
import { StarredFolderHeader } from './StarredFolderHeader.tsx'
import { StarredTree } from './StarredTree.tsx'
import css from './starred.module.css'

const WORKSPACES_SLOT = '[data-slot="sidebar.workspaces"]'
const SEAT_ATTR = 'data-dsh-tl-folder-section'

/** Mac 平台（默认文件夹渐变用蓝色系）。 */
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/**
 * 确保工作区槽位前有挂载座，并在 DOM 变化后复建。
 * @returns 挂载座；工作区槽位不在场时 null。
 */
function useFolderSectionSeat(active: boolean): HTMLElement | null {
  const [seat, setSeat] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) {
      document.querySelector(`[${SEAT_ATTR}]`)?.remove()
      setSeat(null)
      return
    }

    const ensure = (): HTMLElement | null => {
      const hole = document.querySelector(WORKSPACES_SLOT)
      if (!(hole instanceof HTMLElement)) return null
      const parent = hole.parentElement
      if (parent === null) return null
      const existing = parent.querySelector(`[${SEAT_ATTR}]`)
      if (existing instanceof HTMLElement) return existing
      const host = document.createElement('div')
      host.setAttribute(SEAT_ATTR, '')
      parent.insertBefore(host, hole)
      return host
    }

    const apply = (): void => { setSeat(ensure()) }
    apply()
    const hole = document.querySelector(WORKSPACES_SLOT)
    const parent = hole?.parentElement ?? document.body
    const observer = new MutationObserver(apply)
    observer.observe(parent, { childList: true })
    return () => {
      observer.disconnect()
      document.querySelector(`[${SEAT_ATTR}]`)?.remove()
    }
  }, [active])

  return seat
}

/** 侧栏内联文件夹列表 props。 */
export interface SidebarFolderSectionProps {
  readonly wide: boolean
  readonly enabled: boolean
  readonly dark: boolean
  readonly currentSessionId: string | undefined
  readonly openSession: (sessionId: string) => void
  readonly resolveSessionTitle: (sessionId: string) => string | null
  readonly t: TranslateNS<typeof NS>
}

/**
 * 工作区上方的文件夹列表（仅展开侧栏时挂载）。
 * @param props - 侧栏宽态、开关、主题与导航。
 * @returns portal 到工作区槽位前的区块；不展示时 null。
 */
export function SidebarFolderSection({
  wide, enabled, dark, currentSessionId, openSession, resolveSessionTitle, t,
}: SidebarFolderSectionProps) {
  const active = wide && enabled
  const seat = useFolderSectionSeat(active)
  const ui = useSyncExternalStore(starredUiStore.subscribe, () => starredUiStore.getState())
  if (!active || seat === null) return null

  const sectionClass = ui.sidebarCollapsed
    ? `${css.root} ${css.sidebarSection} ${css.collapsed}`
    : `${css.root} ${css.sidebarSection}`

  return createPortal(
    <div
      className={sectionClass}
      data-theme={dark ? 'dark' : 'light'}
      data-folder-variant={IS_MAC ? 'mac' : 'default'}
      data-dsh-starred-root
      data-dsh-starred-boundary
    >
      <StarredFolderHeader
        t={t}
        onToggleCollapse={() => { starredUiStore.setSidebarCollapsed(!ui.sidebarCollapsed) }}
      />
      <StarredTree
        currentSessionId={currentSessionId}
        openSession={openSession}
        onAfterNavigate={() => { /* 内联列表，导航后保持展开 */ }}
        resolveSessionTitle={resolveSessionTitle}
        t={t}
      />
    </div>,
    seat,
  )
}
