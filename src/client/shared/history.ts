import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatNodeStore } from '@deepseek-ai/dsh-client-ui-chat/client'

export interface ChatHistory {
  readonly order: readonly string[]
  readonly nodes: ChatNodeStore
  readonly hasMore: boolean
}

interface HistorySource {
  getSnapshot(): Omit<ChatHistory, 'hasMore'> | undefined
}

interface HistoryOptions {
  readonly signal: AbortSignal
  readonly onPage?: (history: ChatHistory) => void | Promise<void>
  readonly until?: (history: ChatHistory) => boolean
}

function waitForIdle(session: SessionFace, signal: AbortSignal): Promise<void> {
  if (!session.getSnapshot().loadingOlder) return Promise.resolve()
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const cleanup = (): void => {
      unsubscribe()
      signal.removeEventListener('abort', abort)
    }
    const abort = (): void => {
      cleanup()
      reject(signal.reason)
    }
    const check = (): void => {
      if (session.getSnapshot().loadingOlder) return
      cleanup()
      resolve()
    }
    const unsubscribe = session.subscribe(() => { queueMicrotask(check) })
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}

function loadPage(session: SessionFace, signal: AbortSignal): Promise<void> {
  if (session.getSnapshot().loadingOlder) return waitForIdle(session, signal)
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    void session.loadOlder().then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

/** Reuse the host's page loader and let an existing host or plugin request finish first. */
export async function loadChatHistory(
  session: SessionFace, source: HistorySource, { signal, onPage, until }: HistoryOptions,
): Promise<ChatHistory | null> {
  const read = (): ChatHistory | null => {
    const chat = source.getSnapshot()
    return chat === undefined ? null : { order: chat.order, nodes: chat.nodes, hasMore: session.getSnapshot().hasMore }
  }

  let history = read()
  let stalled = 0
  while (history?.hasMore && !until?.(history) && stalled < 3) {
    signal.throwIfAborted()
    const before = history
    await loadPage(session, signal)
    signal.throwIfAborted()

    history = read()
    if (history === null) break
    const moved = history.order[0] !== before.order[0] || history.order.length > before.order.length
    if (moved || !history.hasMore) await onPage?.(history)
    stalled = moved ? 0 : stalled + 1
  }
  return history
}
