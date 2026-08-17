/**
 * 问题列表面板：还原原扩展 QuestionListPopup——与轴条互斥显示、
 * Q 序号 + 单行省略、当前激活行高亮并随滚动联动居中、行内图钉/收藏按钮
 * （hover 行浮现）、header 设置齿轮、文本溢出时富内容 tooltip（时间 + 全文）、
 * 点击行跳转、点击面板外关闭。
 */
import { useEffect, useRef } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { tooltip } from '../ui/tooltip.tsx'
import { panelModal } from '../panelModal/bus.ts'
import { formatNodeTime } from '../shared/text.ts'
import type { StarRecord } from './store.ts'
import type { TimelineItem } from './TimelineBar.tsx'
import css from './timeline.module.css'

/** 问题列表面板 props。 */
export interface QuestionListPanelProps {
  readonly items: readonly TimelineItem[]
  readonly starred: Record<string, StarRecord>
  /** 已标记图钉的节点 key 集合。 */
  readonly pinned: ReadonlySet<string>
  readonly activeKey: string | null
  readonly onJump: (key: string) => void
  readonly onToggleStar: (item: TimelineItem) => void
  readonly onTogglePin: (item: TimelineItem) => void
  readonly onClose: () => void
  readonly t: TranslateNS<typeof NS>
}

/**
 * 问题列表面板。
 * @param props - 节点、收藏集、激活态与回调。
 * @returns 面板（占据轴条位置）。
 */
export function QuestionListPanel({ items, starred, pinned, activeKey, onJump, onToggleStar, onTogglePin, onClose, t }: QuestionListPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 点击面板外关闭（切换按钮自行 stopPropagation，见 TimelineRoot）。
  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) {
        onClose()
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  // 激活行随滚动联动：滚动到列表可视区中央（原版 _scrollActiveIntoView）。
  useEffect(() => {
    if (activeKey === null || listRef.current === null) return
    const row = listRef.current.querySelector(`[data-dsh-ql-key="${CSS.escape(activeKey)}"]`)
    row?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  }, [activeKey])

  return (
    <div ref={panelRef} className={css.qlPopup} role="dialog" aria-label={t('list.aria')}>
      <div className={css.qlHeader}>
        <span className={css.qlTitle}>{t('list.aria')}</span>
        <div className={css.qlHeaderRight}>
          {/* 设置齿轮（原 ait-ql-settings：关面板并打开设置面板时间轴 Tab） */}
          <button
            type="button"
            className={css.qlSettings}
            aria-label={t('prompt.allSettings')}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
              panelModal.show('timeline')
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>
      <div ref={listRef} className={css.qlList}>
        {items.length === 0
          ? <div className={css.qlEmpty}>{t('list.empty')}</div>
          : items.map((item, index) => {
              const isActive = item.key === activeKey
              const isStarred = starred[item.key] !== undefined
              const isPinned = pinned.has(item.key)
              const pinLabel = isPinned ? t('tooltip.unpin') : t('tooltip.pin')
              const starLabel = isStarred ? t('tooltip.unstarAction') : t('tooltip.starAction')
              const timeText = formatNodeTime(item.time)
              return (
                <div
                  key={item.key}
                  data-dsh-ql-key={item.key}
                  className={isActive ? `${css.qlItem} ${css.qlItemActive}` : css.qlItem}
                  onClick={() => { onJump(item.key) }}
                >
                  <span className={css.qlIndex}>{`Q${index + 1}`}</span>
                  <span
                    className={css.qlText}
                    onMouseEnter={(event) => {
                      // 仅溢出时显示富内容 tooltip（原 _buildItemTooltipElement：
                      // 时间 + 全文，placement left / maxWidth 320）。
                      const el = event.currentTarget
                      if (el.scrollWidth <= el.clientWidth) return
                      const row = el.closest(`.${css.qlItem}`)
                      if (!(row instanceof HTMLElement)) return
                      tooltip.show(`ql-item-${item.key}`, row, (
                        <div className={css.tooltipContentWrap}>
                          {timeText !== '' ? <span className={css.tooltipTime}>{timeText}</span> : null}
                          <div className={css.tooltipContent} style={{ pointerEvents: 'none' }}>{item.title}</div>
                        </div>
                      ), { placement: 'left', maxWidth: 320 })
                    }}
                    onMouseLeave={() => { tooltip.hide() }}
                  >
                    {item.title}
                  </span>
                  {/* 图钉（原 ait-ql-item-pin，hover 行浮现） */}
                  <span
                    className={isPinned ? css.qlPin : `${css.qlPin} ${css.qlPinOff}`}
                    role="button"
                    aria-pressed={isPinned}
                    aria-label={pinLabel}
                    onClick={(event) => {
                      event.stopPropagation()
                      tooltip.hide(true)
                      onTogglePin(item)
                    }}
                    onMouseEnter={(event) => {
                      tooltip.show(`ql-pin-${item.key}`, event.currentTarget, pinLabel, { placement: 'top' })
                    }}
                    onMouseLeave={() => { tooltip.hide() }}
                  />
                  <span
                    className={isStarred ? css.qlStar : `${css.qlStar} ${css.qlStarOff}`}
                    role="button"
                    aria-pressed={isStarred}
                    aria-label={starLabel}
                    onClick={(event) => {
                      event.stopPropagation()
                      tooltip.hide(true)
                      onToggleStar(item)
                    }}
                    onMouseEnter={(event) => {
                      tooltip.show(`ql-star-${item.key}`, event.currentTarget, starLabel, { placement: 'top' })
                    }}
                    onMouseLeave={() => { tooltip.hide() }}
                  />
                </div>
              )
            })}
      </div>
    </div>
  )
}
