/**
 * 收藏面板：原扩展 SidebarStarredManager 的 DSH 形态。原版注入宿主站点侧栏
 * DOM；DSH 中以 sidebar.footer.action 槽位按钮 + 锚定浮层承载同一棵收藏树。
 * 头部保留原版交互：标题区（三角 + 「文件夹」）点击折叠列表、新建文件夹按钮。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { settingsStore } from '../shared/settings.ts'
import { tooltip } from '../ui/tooltip.tsx'
import { panelModal } from '../panelModal/bus.ts'
import { createFolderFlow } from './actions.tsx'
import { starredUiStore } from './storage.ts'
import { StarredTree } from './StarredTree.tsx'
import { ChevronIcon } from './icons.tsx'
import css from './starred.module.css'

/** 注入面（activate 时由 ctx 提供）。 */
export interface StarredPanelInject {
  /** 打开指定会话（ctx.sessions.open）。 */
  readonly openSession: (sessionId: string) => void
}

/** 完整 props：侧栏脚槽位 + 注入面 + 词典。 */
export type StarredPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & StarredPanelInject
  & PropsLocale<typeof NS>

/** Mac 平台（文件夹渐变用蓝色系，原 folderIconVariant）。 */
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/**
 * 侧栏脚收藏入口。
 * @param props - 槽位运行时（useSessions 取当前会话）+ openSession + 词典。
 * @returns 触发按钮 + 打开时的浮层面板。
 */
export function StarredPanel({ useSessions, openSession, t }: StarredPanelProps) {
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() => detectDarkTheme())
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const currentSessionId = useSessions(s => s.current)
  const ui = useSyncExternalStore(starredUiStore.subscribe, () => starredUiStore.getState())
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())

  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  // 点击外部 / ESC 关闭面板。
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true) return
      if (btnRef.current?.contains(target) === true) return
      // 全局弹层（下拉/弹窗/确认框）内的点击不关闭面板。
      if (target instanceof Element && target.closest('[data-dsh-dropdown-level]') !== null) return
      setOpen(false)
    }
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick, true)
    document.addEventListener('keydown', onKeydown)
    return () => {
      document.removeEventListener('mousedown', onDocClick, true)
      document.removeEventListener('keydown', onKeydown)
    }
  }, [open])

  // 面板锚定在按钮右侧、底对齐（视口越界时上移）。
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number } | null>(null)
  useEffect(() => {
    if (!open) { setPanelPos(null); return }
    const btn = btnRef.current
    if (btn === null) return
    const rect = btn.getBoundingClientRect()
    setPanelPos({
      left: Math.min(rect.right + 10, window.innerWidth - 330),
      bottom: Math.max(8, window.innerHeight - rect.bottom),
    })
  }, [open])

  // 显示文件夹总开关（原 sidebarStarredPlatformSettings[id] === false 时隐藏入口）。
  if (!settings.starredPanelEnabled) return null

  return (
    <div
      className={css.root}
      data-theme={dark ? 'dark' : 'light'}
      data-folder-variant={IS_MAC ? 'mac' : 'default'}
      data-dsh-starred-root
    >
      <button
        ref={btnRef}
        type="button"
        className={css.footerBtn}
        title={t('starred.open')}
        aria-label={t('starred.open')}
        aria-pressed={open}
        onClick={() => { setOpen(v => !v) }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {open && panelPos !== null
        ? (
          <div
            ref={panelRef}
            className={ui.collapsed ? `${css.panel} ${css.collapsed}` : css.panel}
            style={{ left: panelPos.left, bottom: panelPos.bottom }}
          >
            <div className={css.header}>
              <div
                className={css.titleArea}
                onClick={() => { starredUiStore.setCollapsed(!ui.collapsed) }}
              >
                <span className={css.chevron}><ChevronIcon /></span>
                <span className={css.title}>{t('starred.panelTitle')}</span>
                {/* 帮助（原 ait-ss-help-btn：hover 展示用法小技巧） */}
                <button
                  type="button"
                  className={`${css.headerBtn} ${css.helpBtn}`}
                  aria-label={t('starred.helpTipsTitle')}
                  onClick={(e) => { e.stopPropagation() }}
                  onMouseEnter={(e) => {
                    tooltip.show('starred-help', e.currentTarget, (
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('starred.helpDesc')}</div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('starred.helpTipsTitle')}</div>
                        <div style={{ paddingLeft: 2 }}>
                          <div>{`· ${t('starred.helpTip1')}`}</div>
                          <div>{`· ${t('starred.helpTip2')}`}</div>
                          <div>{`· ${t('starred.helpTip3')}`}</div>
                          <div>{`· ${t('starred.helpTip4')}`}</div>
                        </div>
                      </div>
                    ), { placement: 'top', gap: 6, maxWidth: 260, noArrow: true })
                  }}
                  onMouseLeave={() => { tooltip.hide() }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </button>
                {/* 设置（原 ait-ss-settings-btn：打开设置面板收藏 Tab） */}
                <button
                  type="button"
                  className={`${css.headerBtn} ${css.settingsBtn}`}
                  aria-label={t('starred.settings')}
                  onClick={(e) => {
                    e.stopPropagation()
                    tooltip.hideOverlay()
                    panelModal.show('starred')
                  }}
                  onMouseEnter={(e) => {
                    tooltip.showOverlay(e.currentTarget, t('starred.settings'), { placement: 'top' })
                  }}
                  onMouseLeave={() => { tooltip.hideOverlay() }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              </div>
              <div className={css.headerActions}>
                <button
                  type="button"
                  className={css.headerBtn}
                  title={t('starred.newFolder')}
                  aria-label={t('starred.newFolder')}
                  onClick={() => { void createFolderFlow(null, t) }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </button>
              </div>
            </div>
            <StarredTree
              currentSessionId={currentSessionId}
              openSession={openSession}
              onAfterNavigate={() => { setOpen(false) }}
              t={t}
            />
          </div>
        )
        : null}
    </div>
  )
}
