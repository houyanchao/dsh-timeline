/**
 * 会话头部入口：时间轴显隐开关按钮，并在开启时把时间轴根容器
 * portal 到 document.body（fixed 定位在会话区右侧）。
 * 数据全部来自 useSession 的 Chat 快照（无 DOM 爬取），
 * 显隐/折叠偏好与收藏标记走会话级持久化 store。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../locales.ts'
import { summarizeAssistantBlocks, summarizeBlocks } from '../shared/text.ts'
import { settingsStore } from '../shared/settings.ts'
import { pinsStore, starredStore } from '../starred/storage.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import type { createTimelineStore, StarRecord } from './store.ts'
import { TimelineRoot } from './TimelineRoot.tsx'
import { starEditModal } from './StarModal.tsx'
import type { TimelineItem } from './TimelineBar.tsx'
import css from './timeline.module.css'

/** 整会话收藏 toast 配色（原 toggleChatStar 的 toastColor；黑底改取宿主 tooltip 底板 token）。 */
const CHAT_STAR_TOAST_COLOR = {
  light: { backgroundColor: 'var(--dsw-alias-tooltip-bg)', textColor: '#ffffff', borderColor: 'var(--dsw-alias-tooltip-bg)' },
  dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#d1d5db' },
}

/** 完整 props：会话头部动作槽位运行时 + 声明的 store + 词典。 */
export type TimelineActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsStore<ReturnType<typeof createTimelineStore>>
  & PropsLocale<typeof NS>

/** 计入时间轴的用户输入节点类别（提问 + 轮中追问）。 */
const USER_KINDS = new Set(['user', 'steering'])

/**
 * ChatView 的消息列容器：唯一随对话视图卸载的稳定标记。
 * 注意不能用 [data-conversation-scroll]——那是 ConversationRoot 的常驻
 * 滚动骨架（包着视图区和输入框），切 tab 也不消失。
 */
const CHAT_VIEW_SELECTOR = '[data-chat-flow]'

/**
 * 对话视图是否在场。宿主的视图 ring 只渲染激活 tab
 * （ConversationSession 的 renderSlot only），切到「轨迹」等其他 tab 时
 * ChatView 整体卸载；本组件挂在会话头部（两个 tab 下都在），
 * 时间轴 portal 到 body，需要据此被动隐藏。
 * 宿主的视图选择存在它自己的槽位 store 里，插件拿不到，退而观察 DOM。
 * @returns ChatView 消息列是否存在。
 */
function useChatViewPresent(): boolean {
  const [present, setPresent] = useState(() => document.querySelector(CHAT_VIEW_SELECTOR) !== null)
  useEffect(() => {
    // 状态不变时 setState 由 React 自动跳过，观察全量 DOM 变更开销可接受。
    const check = (): void => { setPresent(document.querySelector(CHAT_VIEW_SELECTOR) !== null) }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])
  return present
}

/** 与 user/steering 节点 data 对齐的最小读取形态。 */
interface UserLikeData {
  readonly content?: readonly unknown[]
  readonly time?: number
}

interface AssistantLikeData {
  readonly blocks?: readonly unknown[]
}

function collectItems(
  order: readonly string[],
  nodes: ChatNodeStore,
  t: TranslateNS<typeof NS>,
): TimelineItem[] {
  const items: TimelineItem[] = []
  let pendingReplyIndex = -1
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || node.visibility === 'hidden') continue
    if (USER_KINDS.has(node.kind)) {
      const data = node.data as UserLikeData
      const title = summarizeBlocks(data.content ?? [])
      items.push({
        key,
        title: title !== '' ? title : t('placeholder.attachment'),
        time: data.time ?? 0,
        reply: '',
      })
      pendingReplyIndex = items.length - 1
      continue
    }
    // 宿主 Chat 视图节点 kind 是 Definition 名：助手为 assistant-step，不是 data.kind。
    if (node.kind !== 'assistant-step' || pendingReplyIndex < 0) continue
    const reply = summarizeAssistantBlocks((node.data as AssistantLikeData).blocks ?? [])
    if (reply === '') continue
    const pending = items[pendingReplyIndex]
    if (pending !== undefined) items[pendingReplyIndex] = { ...pending, reply }
    pendingReplyIndex = -1
  }
  return items
}

/**
 * 会话头部的时间轴入口。
 * @param props - 槽位运行时 + store + 词典。
 * @returns 开关按钮；开启且有提问时渲染时间轴。
 */
export function TimelineAction({ sessionId, useSession, useSessions, useStore, actions, t }: TimelineActionProps) {
  const order = useSession(s => s.chat.order)
  const nodes = useSession(s => s.chat.nodes)
  const running = useSession(s => s.running)
  const collapsed = useStore(s => s.collapsed)
  const chatViewPresent = useChatViewPresent()
  const displayTitle = useSessions(s => s.byId[sessionId]?.displayTitle)
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())

  // 收藏标记来自全局收藏存储（含文件夹归属），按会话过滤成节点映射。
  const starredState = useSyncExternalStore(starredStore.subscribe, () => starredStore.getState())
  const starred = useMemo(() => {
    const map: Record<string, StarRecord> = {}
    for (const item of starredState.items) {
      if (item.sessionId === sessionId && item.nodeKey !== '-1') {
        map[item.nodeKey] = { title: item.question, time: item.timestamp }
      }
    }
    return map
  }, [starredState, sessionId])

  // 图钉标记（原 PinStorageManager.getByUrl 的会话过滤）。
  const pinsState = useSyncExternalStore(pinsStore.subscribe, () => pinsStore.getAll())
  const pinned = useMemo(() => {
    const set = new Set<string>()
    for (const pin of pinsState) {
      if (pin.sessionId === sessionId) set.add(pin.nodeKey)
    }
    return set
  }, [pinsState, sessionId])

  const items = useMemo(() => collectItems(order, nodes, t), [order, nodes, t])

  // 整会话收藏（原 toggleChatStar：key 尾缀 -1）。
  const chatKey = `${sessionId}:-1`
  const chatStarred = starredState.items.some(i => i.key === chatKey)
  const toggleChatStar = (): void => {
    if (chatStarred) {
      starredStore.removeStar(chatKey)
      toast.info(t('starred.unstarred'), null, { color: CHAT_STAR_TOAST_COLOR })
      return
    }
    const defaultTheme = (displayTitle ?? '') !== '' ? (displayTitle ?? '') : (items[0]?.title ?? '')
    void starEditModal.show({
      title: t('starred.starChat'),
      defaultValue: defaultTheme,
      defaultFolderId: null,
    }).then((result) => {
      if (result === null) return
      starredStore.addStar({
        key: chatKey,
        sessionId,
        nodeKey: '-1',
        question: result.value.slice(0, 100),
        timestamp: Date.now(),
        folderId: result.folderId,
      })
      toast.success(t('starred.starSuccess'), null, { color: CHAT_STAR_TOAST_COLOR })
    })
  }

  // 显示时间轴总开关（设置面板控制，头部不再放显隐按钮）。
  if (!settings.timelineEnabled) return null

  const chatStarLabel = chatStarred ? t('starred.unstar') : t('starred.starChat')

  return (
    <>
      {/* 整会话收藏按钮（原 ait-timeline-star-chat-btn-native） */}
      <button
        type="button"
        className={css.headerBtn}
        aria-label={chatStarLabel}
        aria-pressed={chatStarred}
        onClick={(e) => {
          toggleChatStar()
          tooltip.hide(true)
          e.currentTarget.blur()
        }}
        onMouseEnter={(e) => {
          tooltip.show('star-chat-btn', e.currentTarget, chatStarLabel, { placement: 'bottom' })
        }}
        onMouseLeave={() => { tooltip.hide() }}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill={chatStarred ? 'rgb(255, 125, 3)' : 'none'}
          stroke={chatStarred ? 'rgb(255, 125, 3)' : 'currentColor'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        <span>{t('starred.starChatLabel')}</span>
      </button>
      {chatViewPresent && items.length > 0
        ? createPortal(
            <TimelineRoot
              sessionId={sessionId}
              items={items}
              starred={starred}
              pinned={pinned}
              running={running}
              collapsed={collapsed}
              onSetCollapsed={(next) => { actions.setCollapsed(next) }}
              onStar={(item, title, folderId) => {
                starredStore.addStar({
                  key: `${sessionId}:${item.key}`,
                  sessionId,
                  nodeKey: item.key,
                  question: title,
                  timestamp: item.time,
                  folderId,
                })
                toast.success(t('starred.starSuccess'))
              }}
              onUnstar={(item) => { starredStore.removeStar(`${sessionId}:${item.key}`) }}
              onTogglePin={(item) => {
                pinsStore.toggle({
                  key: `${sessionId}:${item.key}`,
                  sessionId,
                  nodeKey: item.key,
                  question: item.title.slice(0, 100),
                  timestamp: Date.now(),
                })
              }}
              t={t}
            />,
            document.body,
          )
        : null}
    </>
  )
}
