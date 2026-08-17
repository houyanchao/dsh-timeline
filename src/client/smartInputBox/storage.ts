/**
 * 提示词库数据层：移植原扩展 chrome.storage.local 'prompts'
 * （panelModal prompt tab 与提示词按钮共用）。
 * localStorage + Bus + storage 事件跨标签页同步。
 */
import { Bus } from '../ui/bus.ts'

/** 提示词（原 prompts 数组元素；DSH 单平台，platformId 字段不再需要）。 */
export interface Prompt {
  readonly id: string
  readonly name: string
  readonly content: string
  readonly pinned?: boolean
}

const STORAGE_KEY = 'dsh.timeline.prompts.v1'

function load(): readonly Prompt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as Prompt[]
    }
  } catch { /* 损坏数据回退为空 */ }
  return []
}

const bus = new Bus<readonly Prompt[]>(load())

function save(next: readonly Prompt[]): void {
  bus.set(next)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* 存储满时忽略 */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) bus.set(load())
  })
}

/** 提示词存储 API（原 panelModal prompt tab 的 CRUD 面）。 */
export const promptsStore = {
  subscribe: bus.subscribe,
  getAll: (): readonly Prompt[] => bus.get(),

  add(name: string, content: string): Prompt {
    const prompt: Prompt = {
      id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name,
      content,
    }
    save([...bus.get(), prompt])
    return prompt
  },

  update(id: string, updates: Partial<Omit<Prompt, 'id'>>): void {
    save(bus.get().map(p => (p.id === id ? { ...p, ...updates } : p)))
  },

  remove(id: string): void {
    save(bus.get().filter(p => p.id !== id))
  },

  togglePin(id: string): void {
    save(bus.get().map(p => (p.id === id ? { ...p, pinned: p.pinned !== true } : p)))
  },

  /** 上移/下移（原 movePrompt：与相邻项交换，边界不动）。 */
  move(id: string, direction: 'up' | 'down'): void {
    const list = [...bus.get()]
    const index = list.findIndex(p => p.id === id)
    if (index === -1) return
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    save(list)
  },
}

/** 置顶优先排序（原 prompt-dropdown-ui 的 sort）。 */
export function sortPrompts(list: readonly Prompt[]): readonly Prompt[] {
  return [...list].sort((a, b) => {
    if (a.pinned === true && b.pinned !== true) return -1
    if (a.pinned !== true && b.pinned === true) return 1
    return 0
  })
}
