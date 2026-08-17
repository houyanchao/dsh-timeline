/**
 * 微型外部 store：命令式 API（toast.show / dropdown.show 等）与 React
 * 宿主组件（useSyncExternalStore）之间的桥。原扩展的各 GlobalXxxManager
 * 是 window 单例 + 直接操作 DOM；DSH 下改为模块单例 + React 渲染。
 */

/** 可订阅的值容器。 */
export class Bus<T> {
  private value: T
  private readonly listeners = new Set<() => void>()

  constructor(initial: T) {
    this.value = initial
  }

  get(): T {
    return this.value
  }

  set(next: T): void {
    this.value = next
    for (const fn of this.listeners) fn()
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.value))
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
