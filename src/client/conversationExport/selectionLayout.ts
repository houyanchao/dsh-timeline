import { useLayoutEffect, useState, type RefObject } from 'react'

export interface MessageMarker {
  readonly key: string
  readonly left: number
  readonly top: number
  readonly outline: { left: number; top: number; width: number; height: number; clipPath: string }
}

interface SelectionLayout {
  readonly center: number
  readonly width: number
  readonly bottom: number
  readonly flow: Element
  readonly extraScrollSpace: number
  readonly mounted: ReadonlySet<string>
  readonly markers: readonly MessageMarker[]
}

const ROW = '[data-chat-flow-key]'
const FLOW = '[data-chat-flow]'
const SCROLLER = '[data-conversation-scroll]'

export function mountedMessageElements(): Map<string, HTMLElement> {
  const flow = document.querySelector(FLOW)
  const elements = new Map<string, HTMLElement>()
  for (const element of flow?.querySelectorAll<HTMLElement>(ROW) ?? []) {
    const key = element.dataset.chatFlowKey
    if (key && !element.closest('[hidden]') && element.getClientRects().length > 0) elements.set(key, element)
  }
  return elements
}

export function useSelectionLayout(
  dockRef: RefObject<HTMLElement>, keys: ReadonlySet<string>, onViewLost: () => void,
): SelectionLayout | null {
  const [layout, setLayout] = useState<SelectionLayout | null>(null)

  useLayoutEffect(() => {
    let frame = 0
    let previous: string | undefined
    let flow: Element | null = null
    let scroll: Element | null = null
    let composer: Element | null = null

    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)

    function measure(): void {
      frame = 0
      const nextFlow = document.querySelector(FLOW)
      if (nextFlow === null) {
        onViewLost()
        return
      }
      const nextScroll = nextFlow?.closest(SCROLLER) ?? null
      const nextComposer = nextScroll?.querySelector('[data-composer-seat]') ?? null
      if (nextFlow !== flow) previous = undefined
      if (nextFlow !== flow || nextScroll !== scroll || nextComposer !== composer) {
        flow = nextFlow
        scroll = nextScroll
        composer = nextComposer
        observer.disconnect()
        for (const node of [dockRef.current, flow, scroll, composer]) {
          if (node !== null) observer.observe(node)
        }
      }

      const bounds = scroll?.getBoundingClientRect()
      const leftLimit = Math.max(0, bounds?.left ?? 0)
      const rightLimit = Math.min(innerWidth, bounds?.right ?? innerWidth)
      const seat = (composer?.querySelector('[data-input-scroll]') ?? composer)?.getBoundingClientRect()
      const width = Math.round(Math.min(920, Math.max(0, rightLimit - leftLimit - 24),
        seat && seat.width > 0 ? Math.max(360, seat.width + 100) : Infinity))
      const center = Math.round(Math.max(leftLimit + width / 2 + 12,
        Math.min(rightLimit - width / 2 - 12, seat ? seat.left + seat.width / 2 : (leftLimit + rightLimit) / 2)))
      const bottom = Math.max(20, innerHeight - (bounds?.bottom ?? innerHeight) + 12)
      // The bar can be taller than the sticky composer. Let the last row scroll
      // clear of it while the selection is open.
      const dockHeight = dockRef.current?.offsetHeight ?? 0
      const extraScrollSpace = composer === null ? 0 : Math.ceil(Math.max(0, dockHeight + 30 - composer.getBoundingClientRect().height))
      const topLimit = Math.max(4, (bounds?.top ?? 0) + 4)
      const bottomLimit = Math.min(innerHeight - bottom - dockHeight - 8, bounds?.bottom ?? innerHeight)
      const mounted = new Set<string>()
      const measured: { key: string; rect: DOMRect }[] = []

      for (const [key, element] of mountedMessageElements()) {
        if (!keys.has(key)) continue
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        mounted.add(key)
        if (rect.bottom > topLimit && rect.top < bottomLimit) measured.push({ key, rect })
      }
      const markers: MessageMarker[] = measured.flatMap(({ key, rect }, index) => {
        const top = Math.min(rect.bottom - 20, Math.max(topLimit, rect.top - 2))
        if (top < topLimit || top + 28 > bottomLimit) return []
        const outlineTop = rect.top - (index === 0 ? 6 : Math.max(0, Math.min(6, (rect.top - measured[index - 1].rect.bottom) / 2 - 2)))
        const outlineBottom = rect.bottom + (index === measured.length - 1 ? 6
          : Math.max(0, Math.min(6, (measured[index + 1].rect.top - rect.bottom) / 2 - 2)))
        const outlineLeft = Math.max(leftLimit + 4, rect.left - 10)
        return [{
          key,
          left: Math.max(leftLimit + 4, rect.left - 42),
          top,
          outline: {
            left: outlineLeft,
            top: outlineTop,
            width: Math.max(0, Math.min(rightLimit - 4, rect.right + 10) - outlineLeft),
            height: outlineBottom - outlineTop,
            clipPath: `inset(${Math.max(0, topLimit - outlineTop)}px 0 ${Math.max(0, outlineBottom - bottomLimit)}px 0)`,
          },
        }]
      })
      const signature = JSON.stringify([center, width, bottom, extraScrollSpace, [...mounted], markers])
      if (signature !== previous) {
        previous = signature
        setLayout({ center, width, bottom, flow: nextFlow, extraScrollSpace, mounted, markers })
      }
    }

    measure()
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-dsh-timeline-selection]')))) schedule()
    })
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] })
    return () => {
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [dockRef, keys, onViewLost])

  return layout
}
