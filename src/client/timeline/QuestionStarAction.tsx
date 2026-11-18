import { useRef, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { starEditModal } from './StarModal.tsx'
import type { TimelineItem } from './TimelineBar.tsx'
import type { StarRecord } from './store.ts'
import css from './timeline.module.css'

interface QuestionStarActionProps {
  readonly items: readonly TimelineItem[]
  readonly starred: Readonly<Record<string, StarRecord>>
  readonly onStar: (item: TimelineItem, title: string, folderId: string) => void
  readonly onUnstar: (item: TimelineItem) => void
  readonly t: TranslateNS<typeof NS>
}

/** Entry for saving a question while the timeline is turned off. */
export function QuestionStarAction({ items, starred, onStar, onUnstar, t }: QuestionStarActionProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const label = t('starred.starQuestion')

  const selectQuestion = (key: string): void => {
    setOpen(false)
    const item = items.find(entry => entry.key === key)
    if (item === undefined) return
    trigger.current?.focus({ preventScroll: true })
    if (Object.hasOwn(starred, key)) {
      onUnstar(item)
      return
    }
    void starEditModal.show({ title: label, defaultValue: item.title, defaultFolderId: null }).then(result => {
      if (trigger.current === null) return
      if (result !== null) onStar(item, result.value, result.folderId)
      trigger.current.focus({ preventScroll: true })
    })
  }

  return (
    <Menu
      open={open}
      anchor={(
        <button ref={trigger} type="button" className={css.headerBtn}
          aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          {label}
        </button>
      )}
      items={open ? items.map(item => ({ id: item.key, label: <span title={item.title}>{item.title}</span> })) : []}
      selectedIds={open ? items.filter(item => Object.hasOwn(starred, item.key)).map(item => item.key) : []}
      onSelect={selectQuestion}
      onClose={() => { setOpen(false) }}
      portal
      autoFocus
      dense
    />
  )
}
