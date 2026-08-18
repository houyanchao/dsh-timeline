/**
 * 工作区会话行收藏角标：对齐原 adapter.refreshStarredIcons。
 * 仅整会话收藏（kind='session'）在标题前插入橙星；宿主行是 React 托管，
 * 重绘会清掉注入节点，故用 MutationObserver + rAF 回补。
 */
import { useEffect, useSyncExternalStore } from 'react'
import { starredStore } from './storage.ts'
import {
  WORKSPACES_SLOT, buildTitleIndex, collectSessionRows, findTitleEl, titleOf,
  type SessionTitleRow,
} from './sessionRowDom.ts'
import css from './starred.module.css'

const ICON_ATTR = 'data-dsh-tl-starred-icon'
const STAR_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="rgb(255, 125, 3)" stroke="rgb(255, 125, 3)" stroke-width="1" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'

/** 工作区星标注入 props。 */
export interface SessionStarIconsProps {
  readonly enabled: boolean
  readonly sessionById: Readonly<Record<string, SessionTitleRow | undefined>>
}

/**
 * 按标题把收藏会话对到工作区行（精确匹配）。
 * 标题被多个会话共用时放弃匹配——星标画错行比不画更糟。
 * @param rows - 可见会话行。
 * @param sessionId - 收藏的会话 id。
 * @param sessionById - 会话标题表。
 * @param titleIndex - 标题唯一性索引（refresh 内每轮构建一次）。
 * @returns 匹配行；对不上或有歧义时 null。
 */
function matchRow(
  rows: readonly HTMLElement[],
  sessionId: string,
  sessionById: Readonly<Record<string, SessionTitleRow | undefined>>,
  titleIndex: ReadonlyMap<string, readonly string[]>,
): HTMLElement | null {
  const title = titleOf(sessionById[sessionId])
  if (title === '') return null
  if ((titleIndex.get(title)?.length ?? 0) !== 1) return null
  const matches = rows.filter(row => (findTitleEl(row)?.textContent?.trim() ?? '') === title)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  return matches.find(row => row.querySelector(`[${ICON_ATTR}]`) === null) ?? matches[0]
}

/**
 * 在标题前插入橙星（已有则跳过）。
 * @param row - 会话行。
 */
function injectStarIcon(row: HTMLElement): void {
  const titleEl = findTitleEl(row)
  if (titleEl === null || titleEl.querySelector(`[${ICON_ATTR}]`) !== null) return
  const icon = document.createElement('span')
  icon.setAttribute(ICON_ATTR, '')
  icon.className = css.sessionStarIcon
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = STAR_SVG
  titleEl.insertBefore(icon, titleEl.firstChild)
}

/**
 * 去掉行上的收藏星。
 * @param row - 会话行。
 */
function removeStarIcon(row: HTMLElement): void {
  row.querySelector(`[${ICON_ATTR}]`)?.remove()
}

/**
 * 按当前收藏集刷新工作区行上的星标。
 * @param sessionById - 会话标题表。
 */
function refresh(sessionById: Readonly<Record<string, SessionTitleRow | undefined>>): void {
  const starredIds = new Set(
    starredStore.getAll()
      .filter(item => item.kind === 'session')
      .map(item => item.sessionId),
  )
  const rows = collectSessionRows()
  const titleIndex = buildTitleIndex(sessionById)
  const marked = new Set<HTMLElement>()
  for (const sessionId of starredIds) {
    const row = matchRow(rows, sessionId, sessionById, titleIndex)
    if (row === null) continue
    injectStarIcon(row)
    marked.add(row)
  }
  for (const row of rows) {
    if (!marked.has(row)) removeStarIcon(row)
  }
}

/**
 * 工作区会话行收藏星（无 UI，只注入宿主 DOM）。
 * @param props - 开关与会话标题表。
 * @returns null。
 */
export function SessionStarIcons({ enabled, sessionById }: SessionStarIconsProps) {
  const starred = useSyncExternalStore(starredStore.subscribe, () => starredStore.getState())

  useEffect(() => {
    if (!enabled) {
      for (const row of collectSessionRows()) removeStarIcon(row)
      return
    }

    let raf = 0
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        refresh(sessionById)
      })
    }

    schedule()
    const hole = document.querySelector(WORKSPACES_SLOT)
    const root = hole instanceof HTMLElement ? hole : document.body
    const observer = new MutationObserver(schedule)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
      for (const row of collectSessionRows()) removeStarIcon(row)
    }
  }, [enabled, sessionById, starred])

  return null
}
