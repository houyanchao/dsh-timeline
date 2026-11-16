import { useLayoutEffect, useState, type RefObject } from 'react'

const HEADER = '[data-slot="conversation.session.header"]'
const FLOW = '[data-chat-flow]'
const SCROLL = '[data-conversation-scroll]'
const HIDDEN = '[hidden], [inert], [aria-hidden="true"]'

export interface ConversationDOM {
  readonly flow: HTMLElement
  readonly scroll: HTMLElement
}

function conversationRoot(anchor: Element | null): HTMLElement | null {
  if (!anchor?.isConnected) return null
  const header = anchor.closest<HTMLElement>(HEADER)
  // Newer hosts nest the strict session header inside the main panel's header slot.
  return header?.closest<HTMLElement>('[data-phase]') ?? header?.parentElement ?? null
}

export function findMessageElement(flow: HTMLElement, key: string): HTMLElement | null {
  const rows = flow.querySelectorAll<HTMLElement>(`[data-chat-flow-key="${CSS.escape(key)}"]`)
  for (const element of rows) {
    if (element.isConnected && element.closest(HIDDEN) === null && element.getClientRects().length > 0) return element
  }
  return null
}

export function findConversationDOM(anchor: Element | null, messageKey?: string): ConversationDOM | null {
  const root = conversationRoot(anchor)
  if (root === null) return null
  for (const flow of root.querySelectorAll<HTMLElement>(FLOW)) {
    const scroll = flow.closest<HTMLElement>(SCROLL)
    if (scroll === null || !root.contains(scroll) || flow.closest(HIDDEN) !== null || flow.getClientRects().length === 0) continue
    if (messageKey === undefined || findMessageElement(flow, messageKey) !== null) return { flow, scroll }
  }
  return null
}

export function ownsConversationDOM(anchor: Element | null, scope: ConversationDOM): boolean {
  return conversationRoot(anchor)?.contains(scope.scroll) === true
    && scope.scroll.contains(scope.flow) && scope.flow.closest(HIDDEN) === null
}

export function useConversationDOM(anchor: RefObject<HTMLElement>): ConversationDOM | null {
  const [scope, setScope] = useState<ConversationDOM | null>(null)
  useLayoutEffect(() => {
    const root = conversationRoot(anchor.current)
    if (root === null) return
    const refresh = (): void => {
      const next = findConversationDOM(anchor.current)
      setScope(previous => previous?.flow === next?.flow && previous?.scroll === next?.scroll ? previous : next)
    }
    refresh()
    const affectsFlow = (node: Node): boolean =>
      node instanceof Element && (node.matches(FLOW) || node.querySelector(FLOW) !== null)
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes' ? affectsFlow(record.target)
        : [...record.addedNodes, ...record.removedNodes].some(affectsFlow))) refresh()
    })
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'inert'] })
    return () => { observer.disconnect() }
  }, [anchor])
  return scope
}
