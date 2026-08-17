/**
 * dsh-timeline-plugin，浏览器半：注册词典与会话头部的时间轴入口。
 * 时间轴数据来自 Chat 快照（useSession），显隐与收藏走会话级持久化 store。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { en, NS, zh, type TimelineKey } from './locales.ts'
import { createTimelineStore } from './timeline/store.ts'
import { TimelineAction } from './timeline/TimelineAction.tsx'
import { StarredPanel } from './starred/StarredPanel.tsx'
import { PromptButton } from './smartInputBox/PromptButton.tsx'
import { QuickAskButton } from './quickAsk/QuickAskButton.tsx'
import { ExportAction } from './conversationExport/ExportAction.tsx'
import { UiHost } from './ui/UiHost.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 时间轴插件文案。 */
    'dshTimeline': TimelineKey
  }
}

export type { TimelineActionProps } from './timeline/TimelineAction.tsx'
export { createTimelineStore } from './timeline/store.ts'

/** 词典注册、槽位贡献与会话导航所需的服务。 */
export const inject = ['slots', 'locale', 'sessions']

/**
 * 客户端插件体：注册词典与会话头部时间轴入口。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-timeline: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'dsh-timeline',
      order: 40,
      locale: NS,
      store: createTimelineStore,
    }, TimelineAction),
  )
  // 命令式 UI 宿主（toast/tooltip/dropdown/popconfirm/inputModal/收藏编辑弹窗/设置面板）。
  ctx.slots.inject(
    'shell.overlay',
    () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'dsh-timeline-ui',
      locale: NS,
      inject: () => ({
        openSession: (sessionId: string) => { ctx.sessions.open(sessionId as SessionId) },
      }),
    }, UiHost),
  )
  // 收藏面板（文件夹树）：侧栏脚入口，点击展开浮层。
  ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'dsh-timeline-starred',
      locale: NS,
      inject: () => ({
        openSession: (sessionId: string) => { ctx.sessions.open(sessionId as SessionId) },
      }),
    }, StarredPanel),
  )
  // 提示词按钮（composer 工具行）+ 智能回车（随组件挂载）。
  ctx.slots.inject(
    'conversation.input.left',
    () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'dsh-timeline-prompt',
      locale: NS,
    }, PromptButton),
  )
  // 追问：选中会话正文后浮出「追问」按钮，引用格式插入输入框
  // （挂 composer 槽位借其会话页生命周期，按钮本体 portal 到 body）。
  ctx.slots.inject(
    'conversation.input.left',
    () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'dsh-timeline-quick-ask',
      locale: NS,
    }, QuickAskButton),
  )
  // 对话导出：会话头部按钮 + 导出弹窗（图片经 readAttachment 解析字节）。
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'dsh-timeline-export',
      order: 41,
      locale: NS,
      inject: () => ({
        resolveAttachment: async (sessionId: string, attachmentId: string) => {
          const session = ctx.sessions.binding(sessionId as SessionId)?.session
          if (session === undefined) return null
          const result = await session.readAttachment(attachmentId as Parameters<typeof session.readAttachment>[0])
          if (!result.ok) return null
          const { attachment, data } = result.value
          return {
            mediaType: attachment.mediaType,
            width: attachment.width,
            height: attachment.height,
            name: attachment.name,
            data,
          }
        },
      }),
    }, ExportAction),
  )
}
