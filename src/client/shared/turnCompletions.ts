import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { findConversationDOM } from './conversationDom.ts'
import { isReadingHistory } from './readingPosition.ts'

export interface TurnCompletionSources {
  readonly completionEvents: SessionEventSource | undefined
  readonly completionChat: { getSnapshot(): ChatSnapshot | undefined }
}

/** Observe the session journal directly so queued turns cannot merge into one React update. */
export function useTurnCompletions(
  { completionEvents, completionChat }: TurnCompletionSources,
  enabled: boolean,
  anchor: RefObject<HTMLElement>,
  onComplete: () => void,
): void {
  const deliver = useRef(onComplete)
  useLayoutEffect(() => { deliver.current = onComplete }, [onComplete])

  useLayoutEffect(() => {
    if (!enabled || completionEvents === undefined) return
    const pending = new Map<number, { timer: number; readingAtEnd: boolean }>()
    const readingHistory = (turn: number, beforeRender = false): boolean => {
      const scope = findConversationDOM(anchor.current)
      const chat = completionChat.getSnapshot()
      return scope !== null && chat !== undefined && isReadingHistory(scope, chat, turn, beforeRender)
    }
    const initial = completionEvents.getSnapshot()
    let revision = initial.revision
    let historyThrough = initial.entries.at(-1)?.event.seq ?? -1
    let lastCompletedTurn = -1
    const unsubscribe = completionEvents.subscribe(() => {
      const snapshot = completionEvents.getSnapshot()
      if (snapshot.revision <= revision) return
      revision = snapshot.revision
      // A reconnect installs a new history window. Mark its tail as already seen.
      if (snapshot.change.kind === 'replace') {
        historyThrough = Math.max(historyThrough, snapshot.change.entries.at(-1)?.event.seq ?? -1)
        return
      }
      if (snapshot.change.kind !== 'append') return
      for (const { event } of snapshot.change.entries) {
        // DSH scrolls to the bottom when the next queued user message is
        // mounted. Settle a confirmed offscreen reply before that forced jump.
        if (event.type === 'turn/start') {
          for (const [turn, check] of pending) {
            if (turn >= event.data.turn || !check.readingAtEnd || !readingHistory(turn, true)) continue
            window.clearTimeout(check.timer)
            pending.delete(turn)
            deliver.current()
          }
          continue
        }
        if (event.type !== 'turn/end' || event.seq <= historyThrough || event.data.reason.kind !== 'completed') continue
        const turn = event.data.turn
        if (turn <= lastCompletedTurn) continue
        lastCompletedTurn = turn
        const readingAtEnd = readingHistory(turn, true)
        const timer = window.setTimeout(() => {
          pending.delete(turn)
          if (readingHistory(turn)) deliver.current()
        }, 200)
        pending.set(turn, { timer, readingAtEnd })
      }
    })
    return () => {
      unsubscribe()
      for (const { timer } of pending.values()) window.clearTimeout(timer)
    }
  }, [enabled, completionEvents, completionChat, anchor])
}
