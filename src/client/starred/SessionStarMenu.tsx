/**
 * 工作区会话三点菜单注入「收藏到文件夹 / 取消收藏」。
 * 对齐原 BaseSidebarStarredAdapter.initNativeMenu：点三点后轮询宿主
 * role=menu，把项插到第二条（重命名之后）。
 */
import { useEffect, useRef } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { toast } from '../ui/toast.tsx'
import { starEditModal } from '../timeline/StarModal.tsx'
import { sessionStarKey, starredStore } from './storage.ts'
import {
  WORKSPACES_SLOT, resolveSessionFromRow, type SessionTitleRow,
} from './sessionRowDom.ts'

const MARKER_ATTR = 'data-dsh-tl-star-menu'
const TRACK_EXPIRE_MS = 3000
const STAR_FILL = 'rgb(255, 125, 3)'

/** 三点菜单注入 props。 */
export interface SessionStarMenuProps {
  readonly enabled: boolean
  readonly sessionById: Readonly<Record<string, SessionTitleRow | undefined>>
  readonly t: TranslateNS<typeof NS>
}

interface TrackedSession {
  readonly sessionId: string
  readonly title: string
  readonly at: number
}

/**
 * 星标 SVG（实心=已收藏，描边=未收藏）。
 * @param filled - 是否实心。
 * @returns SVG 字符串。
 */
function starSvg(filled: boolean): string {
  if (filled) {
    return `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${STAR_FILL}" stroke="${STAR_FILL}" stroke-width="0.5"/></svg>`
  }
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" stroke-width="1.5"/></svg>'
}

/**
 * 当前文档里最近出现的宿主菜单（body 上的 portal）。
 * @returns role=menu 节点；没有则 null。
 */
function findOpenMenu(): HTMLElement | null {
  const menus = document.querySelectorAll<HTMLElement>('body > [role="menu"]')
  return menus.length > 0 ? menus[menus.length - 1] ?? null : null
}

/**
 * 关闭宿主菜单（走 Menu 自己的 Escape 监听）。
 */
function closeHostMenu(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/**
 * 在宿主菜单里插入收藏项（已有则只更新状态）。
 * @param menu - 宿主 menu。
 * @param tracked - 当前会话。
 * @param t - 词典。
 */
function injectMenuItem(
  menu: HTMLElement,
  tracked: TrackedSession,
  t: TranslateNS<typeof NS>,
): void {
  const key = sessionStarKey(tracked.sessionId)
  const starred = starredStore.exists(key)
  const existing = menu.querySelector<HTMLElement>(`[${MARKER_ATTR}]`)
  if (existing !== null) {
    paintMenuItem(existing, starred, t)
    return
  }
  const items = menu.querySelectorAll('[role="menuitem"]')
  if (items.length === 0) return
  const first = items[0]
  if (!(first instanceof HTMLElement)) return
  const wrap = first.parentElement
  if (wrap === null) return
  const clone = wrap.cloneNode(true)
  if (!(clone instanceof HTMLElement)) return
  const btn = clone.querySelector('[role="menuitem"]')
  if (!(btn instanceof HTMLElement)) return
  btn.removeAttribute('aria-haspopup')
  btn.removeAttribute('aria-expanded')
  btn.removeAttribute('disabled')
  clone.setAttribute(MARKER_ATTR, '')
  paintMenuItem(clone, starred, t)
  const onPick = (e: Event): void => {
    e.preventDefault()
    e.stopPropagation()
    closeHostMenu()
    const sessionId = tracked.sessionId
    const title = tracked.title
    window.setTimeout(() => {
      if (starredStore.exists(key)) {
        starredStore.removeStar(key)
        toast.success(t('starred.unstarred'))
        return
      }
      void starEditModal.show({
        title: t('starred.starChat'),
        defaultValue: title,
        defaultFolderId: null,
      }).then((result) => {
        if (result === null) return
        starredStore.addStar({
          key: sessionStarKey(sessionId),
          kind: 'session',
          sessionId,
          nodeKey: '',
          title: result.value.slice(0, 100),
          timestamp: Date.now(),
          folderId: result.folderId,
        })
        toast.success(t('starred.starSuccess'))
      })
    }, 150)
  }
  clone.addEventListener('click', onPick, true)
  btn.addEventListener('click', onPick, true)
  const second = wrap.nextElementSibling
  wrap.parentElement?.insertBefore(clone, second)
}

/**
 * 更新注入项的文案、图标和危险色。
 * @param host - 注入的 wrap。
 * @param starred - 是否已收藏。
 * @param t - 词典。
 */
function paintMenuItem(host: HTMLElement, starred: boolean, t: TranslateNS<typeof NS>): void {
  const btn = host.matches('[role="menuitem"]') ? host : host.querySelector('[role="menuitem"]')
  if (!(btn instanceof HTMLElement)) return
  const labels = btn.querySelectorAll('span')
  const icon = labels[0]
  const label = labels[1]
  if (icon !== undefined) icon.innerHTML = starSvg(starred)
  if (label !== undefined) label.textContent = starred ? t('starred.unstar') : t('starred.starChat')
  btn.style.color = starred ? '#ef4444' : ''
}

/**
 * 工作区会话三点菜单的收藏项（无 UI）。
 * @param props - 开关、会话表、词典。
 * @returns null。
 */
export function SessionStarMenu({ enabled, sessionById, t }: SessionStarMenuProps) {
  const byIdRef = useRef(sessionById)
  byIdRef.current = sessionById
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    if (!enabled) return
    let tracked: TrackedSession | null = null
    let poll = 0
    let menuObserver: MutationObserver | null = null

    const stopWatch = (): void => {
      menuObserver?.disconnect()
      menuObserver = null
    }

    const tryInject = (attempt: number): void => {
      if (tracked === null || Date.now() - tracked.at > TRACK_EXPIRE_MS) return
      if (attempt > 12) return
      const menu = findOpenMenu()
      if (menu === null) {
        poll = window.setTimeout(() => { tryInject(attempt + 1) }, 32)
        return
      }
      injectMenuItem(menu, tracked, tRef.current)
      stopWatch()
      menuObserver = new MutationObserver(() => {
        if (tracked === null || !menu.isConnected) {
          stopWatch()
          return
        }
        injectMenuItem(menu, tracked, tRef.current)
      })
      menuObserver.observe(menu, { childList: true, subtree: true })
    }

    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target
      if (!(target instanceof Element)) return
      const hole = document.querySelector(WORKSPACES_SLOT)
      if (!(hole instanceof HTMLElement) || !hole.contains(target)) return
      const row = target.closest('div[role="treeitem"][aria-selected]')
      if (!(row instanceof HTMLElement)) return
      const btn = target.closest('button')
      if (btn === null || !row.contains(btn)) return
      const resolved = resolveSessionFromRow(row, byIdRef.current)
      if (resolved === null) return
      tracked = { ...resolved, at: Date.now() }
      window.clearTimeout(poll)
      stopWatch()
      poll = window.setTimeout(() => { tryInject(0) }, 0)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.clearTimeout(poll)
      stopWatch()
    }
  }, [enabled])

  return null
}
