/** Keep keyboard navigation inside the open settings dialog and return focus to its opener. */
export function containDialogFocus(dialog: HTMLElement, opener: HTMLElement | null, dismiss: () => void) {
  const controls = () => dialog.querySelectorAll<HTMLElement>('button:enabled, input:enabled')
  const focusFirst = () => controls()[0]?.focus()
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      dismiss()
      return
    }
    if (event.key !== 'Tab') return
    const items = controls()
    const first = items[0]
    const last = items[items.length - 1]
    if (document.activeElement === (event.shiftKey ? first : last) || !dialog.contains(document.activeElement)) {
      event.preventDefault()
      const next = event.shiftKey ? last : first
      next?.focus()
    }
  }
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst()
  }
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('focusin', onFocusIn, true)
  focusFirst()
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('focusin', onFocusIn, true)
    if (opener?.isConnected) opener.focus()
  }
}
