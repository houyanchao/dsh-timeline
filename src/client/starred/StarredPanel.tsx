/**
 * 收藏入口：侧栏脚槽位只作挂载点，把文件夹列表 portal 到工作区上方。
 * 侧栏脚不再渲染文件夹图标与浮层。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { settingsStore } from '../shared/settings.ts'
import { SidebarFolderSection } from './SidebarFolderSection.tsx'
import { SessionStarIcons } from './SessionStarIcons.tsx'
import { SessionStarMenu } from './SessionStarMenu.tsx'

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

/**
 * 侧栏收藏列表挂载点。
 * @param props - 槽位运行时（useSessions 取当前会话）+ openSession + 词典。
 * @returns 工作区上方的内联列表；开关关闭时 null。
 */
export function StarredPanel({ useSessions, openSession, t, wide }: StarredPanelProps) {
  const [dark, setDark] = useState(() => detectDarkTheme())
  const currentSessionId = useSessions(s => s.current)
  const sessionById = useSessions(s => s.byId)
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())

  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  const resolveSessionTitle = (sessionId: string): string | null => {
    const row = (sessionById as Record<string, { displayTitle?: string; title?: string } | undefined>)[sessionId]
    if (row === undefined) return null
    const title = (row.displayTitle ?? row.title ?? '').trim()
    return title !== '' ? title : sessionId
  }

  return (
    <>
      <SessionStarIcons
        enabled={settings.starredPanelEnabled}
        sessionById={sessionById as Record<string, { displayTitle?: string; title?: string } | undefined>}
      />
      <SessionStarMenu
        enabled={settings.starredPanelEnabled}
        sessionById={sessionById as Record<string, { displayTitle?: string; title?: string } | undefined>}
        t={t}
      />
      {settings.starredPanelEnabled
        ? (
          <SidebarFolderSection
            wide={wide}
            enabled={settings.starredPanelEnabled}
            dark={dark}
            currentSessionId={currentSessionId}
            openSession={openSession}
            resolveSessionTitle={resolveSessionTitle}
            t={t}
          />
        )
        : null}
    </>
  )
}
