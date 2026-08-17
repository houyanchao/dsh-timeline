/**
 * 通用 UI 宿主：挂在 shell.overlay 槽位，承载全部命令式 UI
 * （toast / tooltip / dropdown / popconfirm / inputModal / 文件夹编辑弹窗 /
 * 收藏编辑弹窗）的渲染。主题跟随宿主（原版 html[data-timeline-theme] 的等价物）。
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { FolderEditModalHost } from '../starred/FolderEditModal.tsx'
import { StarEditModalHost } from '../timeline/StarModal.tsx'
import { NotepadHost } from '../notepad/NotepadPanel.tsx'
import { PanelHost } from '../panelModal/PanelHost.tsx'
import { ChangelogHost } from '../changelog/ChangelogModal.tsx'
import { FormulaHost } from '../formula/FormulaHost.tsx'
import starredCss from '../starred/starred.module.css'
import { ToastHost, toast } from './toast.tsx'
import { TooltipHost, tooltip } from './tooltip.tsx'
import { DropdownHost, dropdown } from './dropdown.tsx'
import { PopconfirmHost, popconfirm } from './popconfirm.tsx'
import { InputModalHost, inputModal } from './inputModal.tsx'
import css from './ui.module.css'

/** UiHost props（root 槽位运行时 + 词典 + 设置面板收藏 tab 的会话导航）。 */
export type UiHostProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & {
  /** 打开指定会话（ctx.sessions.open）。 */
  readonly openSession: (sessionId: string) => void
}

/**
 * 通用 UI 宿主组件。
 * @param props - 词典 + 会话导航。
 * @returns 各命令式 UI 的渲染宿主。
 */
export function UiHost({ t, useSessions, openSession }: UiHostProps) {
  const currentSessionId = useSessions(s => s.current)
  const [dark, setDark] = useState(() => detectDarkTheme())
  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  // 会话切换时清理全部浮层（原各管理器监听 url:change 的自治清理：
  // toast forceHideAll / tooltip forceHideAll / dropdown forceHideAll /
  // popconfirm hide(false) / inputModal forceClose）。
  const prevSessionRef = useRef(currentSessionId)
  useEffect(() => {
    if (prevSessionRef.current === currentSessionId) return
    prevSessionRef.current = currentSessionId
    toast.forceHideAll()
    tooltip.forceHideAll()
    dropdown.forceHideAll()
    popconfirm.hide(false)
    inputModal.forceClose()
  }, [currentSessionId])

  return (
    <div className={css.host} data-theme={dark ? 'dark' : 'light'}>
      <ToastHost dark={dark} />
      <TooltipHost dark={dark} />
      <DropdownHost />
      <PopconfirmHost
        defaultConfirmText={t('common.confirm')}
        defaultCancelText={t('common.cancel')}
      />
      <InputModalHost
        defaults={{
          placeholder: t('common.inputPlaceholder'),
          requiredMessage: t('common.inputRequired'),
          confirmText: t('common.confirm'),
          cancelText: t('common.cancel'),
        }}
      />
      {/* 文件夹编辑弹窗样式挂在收藏模块主题容器下。 */}
      <div className={starredCss.root} data-theme={dark ? 'dark' : 'light'}>
        <FolderEditModalHost />
      </div>
      <StarEditModalHost t={t} dark={dark} />
      <NotepadHost t={t} dark={dark} />
      <PanelHost t={t} currentSessionId={currentSessionId} openSession={openSession} />
      <ChangelogHost t={t} />
      {/* 公式复制（hover 高亮 + tooltip + 点击复制 LaTeX/MathML）。 */}
      <FormulaHost t={t} dark={dark} currentSessionId={currentSessionId} />
    </div>
  )
}
