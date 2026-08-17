/** 时间轴插件的会话级 UI 状态：显隐/折叠偏好（localStorage 持久化）。
 * 收藏数据已上移到全局收藏存储（../starred/storage.ts，含文件夹归属）。 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'

/** 一条收藏记录：摘要与提问时间，用于时间轴打点与列表展示。 */
export interface StarRecord {
  readonly title: string
  readonly time: number
}

/** 时间轴 UI 状态。 */
export interface TimelineState {
  /** 时间轴功能开关（会话头部按钮，默认开启）。 */
  visible: boolean
  /** 时间轴收起状态（右缘折叠按钮，对应原扩展 _aitTimelineCollapsed）。 */
  collapsed: boolean
}

/**
 * 声明时间轴 store（session 作用域实例化：persist key 自动带 sessionId 后缀）。
 * @returns store handle，供 slot 注册处声明。
 */
export function createTimelineStore() {
  return defineStore({
    init: (): TimelineState => ({ visible: true, collapsed: false }),
    persist: 'dsh.timeline',
    actions: {
      setVisible: (draft, visible: boolean) => { draft.visible = visible },
      setCollapsed: (draft, collapsed: boolean) => { draft.collapsed = collapsed },
    },
  })
}
