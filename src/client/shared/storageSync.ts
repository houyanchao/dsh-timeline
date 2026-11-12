import type { Context as ClientContext } from '@deepseek-ai/cordis'

const handlers = new Map<string, () => void>()

export function registerStorageSync(key: string, reload: () => void): void {
  handlers.set(key, reload)
}

/** Keep the browser listener within the plugin's lifetime. */
export function bindStorageSync(ctx: ClientContext): void {
  ctx.effect(() => {
    for (const reload of handlers.values()) reload()
    const sync = (event: StorageEvent): void => {
      if (event.storageArea !== localStorage) return
      if (event.key === null) {
        for (const reload of handlers.values()) reload()
      } else {
        handlers.get(event.key)?.()
      }
    }
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('storage', sync) }
  }, 'dsh-timeline: storage sync')
}
