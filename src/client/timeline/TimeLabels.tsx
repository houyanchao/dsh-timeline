/**
 * 消息旁时间标签：移植原扩展 ChatTimeRecorder 的渲染半（提问时间以伪元素
 * 挂在消息元素右上角；今年的时间可点击/回车切换完整年月日格式）。
 * 原版需自建 storage 记录提问时间；DSH 中节点时间来自会话快照（item.time），
 * 记录半不再需要。标签通过 portal 渲染进宿主消息元素。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatFullNodeTime, formatNodeTime, isNodeTimeToggleable } from '../shared/text.ts'
import { findMessageElement, type TimelineItem } from './TimelineBar.tsx'
import css from './timeline.module.css'

/** 时间标签宿主 props。 */
export interface TimeLabelsProps {
  readonly items: readonly TimelineItem[]
  readonly dark: boolean
}

/** 单条消息的 portal 目标。 */
interface LabelTarget {
  readonly item: TimelineItem
  readonly el: HTMLElement
}

/** 时间标签宿主（挂在 TimelineRoot 内）。 */
export function TimeLabels({ items, dark }: TimeLabelsProps) {
  const [targets, setTargets] = useState<readonly LabelTarget[]>([])
  /** 展开为完整格式的节点 key（原 _expandedNodeIds）。 */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  // 查找消息元素并保证可定位（原 _doRenderTimeLabels 的 target 处理）。
  useEffect(() => {
    let raf = 0
    const resolve = (): void => {
      const next: LabelTarget[] = []
      for (const item of items) {
        if (item.time === 0) continue
        const el = findMessageElement(item.key)
        if (el === null) continue
        if (getComputedStyle(el).position === 'static') {
          el.style.position = 'relative'
        }
        next.push({ item, el })
      }
      setTargets((prev) => {
        if (prev.length === next.length && prev.every((p, i) => p.el === next[i].el && p.item === next[i].item)) {
          return prev
        }
        return next
      })
    }
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        resolve()
      })
    }
    schedule()
    // 流式渲染期间消息节点增删：观察消息列 DOM 变化。
    const column = document.querySelector('[data-chat-flow]')
    const observer = new MutationObserver(schedule)
    if (column !== null) observer.observe(column, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [items])

  const toggle = (key: string, time: number): void => {
    if (!isNodeTimeToggleable(time)) return
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      {targets.map(({ item, el }) => {
        const toggleable = isNodeTimeToggleable(item.time)
        const isExpanded = toggleable && expanded.has(item.key)
        const display = isExpanded ? formatFullNodeTime(item.time) : formatNodeTime(item.time)
        if (display === '') return null
        return createPortal(
          <span
            key={item.key}
            className={toggleable ? `${css.timeLabel} ${css.timeLabelToggleable}` : css.timeLabel}
            data-ait-time={display}
            data-tl-dark={dark ? 'true' : 'false'}
            aria-label={display}
            {...(toggleable
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-pressed': isExpanded,
                  onClick: (e: React.MouseEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggle(item.key, item.time)
                  },
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    e.stopPropagation()
                    toggle(item.key, item.time)
                  },
                }
              : {})}
          />,
          el,
        )
      })}
    </>
  )
}
