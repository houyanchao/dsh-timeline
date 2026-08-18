/**
 * 收藏列表标题栏：与侧栏脚弹窗头部同一套交互。
 * 标题区（三角 + 「文件夹」）点击折叠列表；帮助 / 设置 / 新建文件夹。
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { tooltip } from '../ui/tooltip.tsx'
import { panelModal } from '../panelModal/bus.ts'
import { createFolderFlow } from './actions.tsx'
import { ChevronIcon } from './icons.tsx'
import css from './starred.module.css'

/** 标题栏 props。 */
export interface StarredFolderHeaderProps {
  readonly onToggleCollapse: () => void
  readonly t: TranslateNS<typeof NS>
}

/**
 * 收藏列表标题栏。
 * @param props - 折叠回调与词典。
 * @returns 标题区 + 新建按钮。
 */
export function StarredFolderHeader({ onToggleCollapse, t }: StarredFolderHeaderProps) {
  return (
    <div className={css.header}>
      <div
        className={css.titleArea}
        onClick={onToggleCollapse}
      >
        <span className={css.chevron}><ChevronIcon /></span>
        <span className={css.title}>{t('starred.panelTitle')}</span>
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
          className={`${css.headerBtn} ${css.headerActionBtn}`}
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
  )
}
