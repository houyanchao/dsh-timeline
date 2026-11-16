import { findConversationDOM, findMessageElement, ownsConversationDOM, type ConversationDOM } from '../shared/conversationDom.ts'
import { smoothScrollTo } from './engine.ts'

interface QuestionTarget extends ConversationDOM {
  readonly row: HTMLElement
}

export function findQuestionTarget(anchor: Element | null, key: string): QuestionTarget | null {
  const scope = findConversationDOM(anchor, key)
  if (scope === null) return null
  const row = findMessageElement(scope.flow, key)
  return row === null ? null : { ...scope, row }
}

function waitForQuestionTarget(
  anchor: () => Element | null, key: string, signal: AbortSignal, previous?: QuestionTarget,
): Promise<QuestionTarget | null> {
  const read = (): QuestionTarget | null => {
    const target = findQuestionTarget(anchor(), key)
    return target !== null && target.row === previous?.row && target.scroll === previous.scroll ? null : target
  }
  if (signal.aborted) return Promise.resolve(null)
  const existing = read()
  if (existing !== null) return Promise.resolve(existing)

  return new Promise(resolve => {
    const finish = (target: QuestionTarget | null): void => {
      observer.disconnect()
      signal.removeEventListener('abort', abort)
      resolve(target)
    }
    const abort = (): void => { finish(null) }
    const observer = new MutationObserver(() => {
      const target = read()
      if (target !== null) finish(target)
    })
    // The current message flow and its scrollport may both be replaced.
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'inert', 'aria-hidden', 'data-chat-flow-key'],
    })
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function navigateToQuestion(
  anchor: () => Element | null, key: string, signal: AbortSignal,
): Promise<boolean> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(3000)])
  let target = await waitForQuestionTarget(anchor, key, deadline)
  while (target !== null && !deadline.aborted) {
    const current = target
    const ownsTarget = (): boolean => ownsConversationDOM(anchor(), current) && current.flow.contains(current.row)
    if (await smoothScrollTo(current.scroll, current.row, deadline, ownsTarget)) return true
    target = await waitForQuestionTarget(anchor, key, deadline, current)
  }
  return false
}
