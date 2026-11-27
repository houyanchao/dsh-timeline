import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { findMessageElement, type ConversationDOM } from './conversationDom.ts'
import { LAYOUT } from '../timeline/engine.ts'

export function isReadingHistory(
  { flow, scroll }: ConversationDOM, chat: ChatSnapshot, turn: number,
  beforeRender = false,
): boolean {
  // Match the host's bottom-pinning tolerance, including fractional scroll offsets.
  if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 25) return false

  let questionKey: string | undefined
  let replyKey: string | undefined
  for (const key of chat.locations.getTurn(turn)) {
    const node = chat.nodes.get(key)
    if (node === undefined || node.visibility === 'hidden') continue
    if (node.kind === 'user' || node.kind === 'steering') {
      questionKey = key
      replyKey = undefined
    } else if (node.kind === 'assistant-step') {
      replyKey = key
    }
  }
  if (questionKey === undefined) return false
  const firstQuestion = chat.order.find(key => {
    const node = chat.nodes.get(key)
    return node?.visibility === 'visible' && (node.kind === 'user' || node.kind === 'steering')
  })
  if (firstQuestion === undefined || firstQuestion === questionKey) return false

  const question = findMessageElement(flow, questionKey)
  if (question === null) return false
  const viewport = scroll.getBoundingClientRect()
  const questionBox = question.getBoundingClientRect()
  if (questionBox.top <= viewport.top + LAYOUT.ACTIVATE_AHEAD) return false

  // A short answer can already be fully visible below the activation line.
  // The host's sticky composer can cover the bottom part of the scrollport.
  const composer = scroll.querySelector<HTMLElement>('[data-composer-seat]')
  const bottom = composer?.getClientRects().length
    ? Math.min(viewport.bottom, composer.getBoundingClientRect().top) : viewport.bottom
  // If the question extends to the visible edge, its reply is below it.
  if (questionBox.bottom >= bottom) return true
  const reply = replyKey === undefined ? null : findMessageElement(flow, replyKey)
  if (reply !== null) {
    const box = reply.getBoundingClientRect()
    if (box.height > 0) return box.bottom > bottom || (!beforeRender && box.top < viewport.top)
  }
  // At queue handoff, allow an unpainted answer to settle in the ordinary timer.
  return !beforeRender
}
