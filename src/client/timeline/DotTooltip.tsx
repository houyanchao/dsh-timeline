/**
 * 圆点悬浮气泡：还原原扩展 timeline-tooltip——顶部时间标签 + 问题全文
 * （5 行截断、点击复制、hover 可保持）+ 底部操作区（图钉 + 星标，
 * hover 显示 mini 提示）。定位在轴条左侧（placement=left），垂直对齐
 * 圆点中心并做视口 clamp。
 */
import { useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { formatNodeTime } from '../shared/text.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import type { TimelineItem } from './TimelineBar.tsx'
import css from './timeline.module.css'

/** 气泡组件 props。 */
export interface DotTooltipProps {
  readonly item: TimelineItem
  readonly anchorRect: DOMRect
  readonly isStarred: boolean
  readonly isPinned: boolean
  readonly onToggleStar: () => void
  readonly onTogglePin: () => void
  readonly onPointerEnter: () => void
  readonly onPointerLeave: () => void
  readonly t: TranslateNS<typeof NS>
}

/** 气泡与圆点的水平间距（原 computePlacementInfo 运行时缓存 12+6+8=26）。 */
const GAP = 26
/** 视口边距（原 viewportPad）。 */
const VIEWPORT_PAD = 8
/** 气泡最大宽（原 maxW，与 --tl-tooltip-max 一致）。 */
const MAX_WIDTH = 288
/** 宽度档位（原 tiers，按可用空间取第一个放得下的档）。 */
const WIDTH_TIERS = [280, 240, 200, 160]
/** 宽度下限（原 clamp 的 120）。 */
const MIN_WIDTH = 120

/**
 * 计算气泡宽度（移植原 computePlacementInfo 的 left placement 分支：
 * 时间轴贴视口右缘，气泡恒在左侧展开）。
 * @param anchorLeft - 圆点左缘视口 X。
 * @returns 气泡像素宽。
 */
function computeTooltipWidth(anchorLeft: number): number {
  const avail = Math.max(0, anchorLeft - GAP - VIEWPORT_PAD)
  const hardMax = Math.max(160, Math.min(MAX_WIDTH, Math.floor(avail)))
  const width = WIDTH_TIERS.find(tier => tier <= hardMax) ?? Math.max(MIN_WIDTH, Math.min(hardMax, 160))
  return Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH))
}

/**
 * 圆点悬浮气泡。
 * @param props - 节点、锚点矩形、收藏态与回调。
 * @returns fixed 定位的气泡。
 */
export function DotTooltip({ item, anchorRect, isStarred, isPinned, onToggleStar, onTogglePin, onPointerEnter, onPointerLeave, t }: DotTooltipProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchorRect.top + anchorRect.height / 2)

  // 渲染后按实际高度做视口 clamp（原版 placeTooltipAt 的等价物）。
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const height = el.offsetHeight
    const center = anchorRect.top + anchorRect.height / 2
    const min = 8 + height / 2
    const max = window.innerHeight - 8 - height / 2
    setTop(Math.max(min, Math.min(center, max)))
  }, [anchorRect, item])

  const timeText = formatNodeTime(item.time)

  return (
    <div
      ref={ref}
      className={`${css.tooltip} ${css.tooltipVisible}`}
      data-placement="left"
      style={{
        top: `${top}px`,
        right: `${window.innerWidth - anchorRect.left + GAP}px`,
        width: `${computeTooltipWidth(anchorRect.left)}px`,
        transform: 'translateY(-50%)',
      }}
      role="tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className={css.tooltipContainer}>
        <div className={css.tooltipContentWrap}>
          {timeText !== '' ? <span className={css.tooltipTime}>{timeText}</span> : null}
          <div
            className={css.tooltipContent}
            title={t('tooltip.copy')}
            onClick={(e) => {
              // 复制全文并 toast 反馈（原 copyToClipboard + showCopyFeedback，
              // toast 锚定正文元素）。
              const anchor = e.currentTarget
              navigator.clipboard?.writeText(item.title).then(() => {
                // 原 toast 文案为 xpzmvk「复制成功/Copied」，对应 starred.copied。
                toast.success(t('starred.copied'), anchor)
              }).catch(() => {})
            }}
          >
            {item.title}
          </div>
          {item.reply !== ''
            ? <div className={css.tooltipReply}>{item.reply}</div>
            : null}
        </div>
        <div className={css.tooltipActions}>
          <span
            className={isPinned ? css.tooltipPin : `${css.tooltipPin} ${css.tooltipPinOff}`}
            role="button"
            aria-pressed={isPinned}
            aria-label={isPinned ? t('tooltip.unpin') : t('tooltip.pin')}
            onClick={(event) => {
              event.stopPropagation()
              tooltip.hideOverlay()
              onTogglePin()
            }}
            onMouseEnter={(event) => {
              tooltip.showOverlay(event.currentTarget, isPinned ? t('tooltip.unpin') : t('tooltip.pin'), { placement: 'top' })
            }}
            onMouseLeave={() => { tooltip.hideOverlay() }}
          />
          <span
            className={isStarred ? css.tooltipStar : `${css.tooltipStar} ${css.tooltipStarOff}`}
            role="button"
            aria-pressed={isStarred}
            aria-label={isStarred ? t('tooltip.unstarAction') : t('tooltip.starAction')}
            onClick={(event) => {
              event.stopPropagation()
              tooltip.hideOverlay()
              onToggleStar()
            }}
            onMouseEnter={(event) => {
              tooltip.showOverlay(event.currentTarget, isStarred ? t('tooltip.unstarAction') : t('tooltip.starAction'), { placement: 'top' })
            }}
            onMouseLeave={() => { tooltip.hideOverlay() }}
          />
        </div>
      </div>
    </div>
  )
}
