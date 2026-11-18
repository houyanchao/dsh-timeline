/**
 * 会话头部收藏入口。时间轴开启时将时间轴根容器 portal 到 document.body，
 * 关闭时从会话头部打开提问收藏菜单。
 * 数据全部来自 useSession 的 Chat 快照（无 DOM 爬取），
 * 显隐/折叠偏好与收藏标记走会话级持久化 store。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeStore } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../locales.ts'
import { summarizeAssistantBlocks, summarizeBlocks } from '../shared/text.ts'
import { settingsStore } from '../shared/settings.ts'
import { useConversationDOM } from '../shared/conversationDom.ts'
import { nodeStarKey, pendingNavigateStore, pinsStore, sessionStarKey, starredStore, type PendingNavigate } from '../starred/storage.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import type { createTimelineStore, StarRecord } from './store.ts'
import { TimelineRoot } from './TimelineRoot.tsx'
import { QuestionStarAction } from './QuestionStarAction.tsx'
import { starEditModal } from './StarModal.tsx'
import type { TimelineItem } from './TimelineBar.tsx'
import { findQuestionTarget, navigateToQuestion } from './navigation.ts'
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
  & { readonly loadSavedQuestion: (sessionId: string, nodeKey: string, signal: AbortSignal) => Promise<boolean> }

/** 计入时间轴的用户输入节点类别（提问 + 轮中追问）。 */
const USER_KINDS = new Set(['user', 'steering'])

function useQuestionNavigation(
  sessionId: string, anchor: RefObject<HTMLElement>, chatViewPresent: boolean,
  loadSavedQuestion: TimelineActionProps['loadSavedQuestion'],
  t: TranslateNS<typeof NS>,
): (key: string) => Promise<boolean> {
  const current = useRef<{ controller: AbortController; saved?: PendingNavigate } | null>(null)

  useLayoutEffect(() => () => { current.current?.controller.abort() }, [sessionId])

  const start = useCallback(async (key: string, saved?: PendingNavigate): Promise<boolean> => {
    current.current?.controller.abort()
    const controller = new AbortController()
    current.current = { controller, saved }
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
    try {
      const ready = saved === undefined || findQuestionTarget(anchor.current, key) !== null
        || await loadSavedQuestion(sessionId, key, signal)
      const reached = ready && await navigateToQuestion(() => anchor.current, key, signal)
      if (saved !== undefined && !reached && !controller.signal.aborted) toast.warning(t('starred.questionUnavailable'))
      return reached
    } catch {
      if (saved !== undefined && !controller.signal.aborted) toast.warning(t('starred.questionUnavailable'))
      return false
    } finally {
      if (current.current?.controller === controller) current.current = null
      if (saved !== undefined && !controller.signal.aborted && pendingNavigateStore.get() === saved) pendingNavigateStore.set(null)
    }
  }, [anchor, sessionId, loadSavedQuestion, t])

  useEffect(() => {
    if (!chatViewPresent) return
    const navigateStored = (): void => {
      const target = pendingNavigateStore.get()
      if (target?.sessionId === sessionId && current.current?.saved !== target) void start(target.nodeKey, target)
    }
    const unsubscribe = pendingNavigateStore.subscribe(navigateStored)
    navigateStored()
    return unsubscribe
  }, [sessionId, chatViewPresent, start])

  return useCallback((key: string) => {
    if (pendingNavigateStore.get()?.sessionId === sessionId) pendingNavigateStore.set(null)
    return start(key)
  }, [sessionId, start])
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

function sameTimelineItems(previous: readonly TimelineItem[], next: readonly TimelineItem[]): boolean {
  return previous.length === next.length && previous.every((item, index) => {
    const other = next[index]
    return item.key === other.key && item.title === other.title
      && item.time === other.time && item.reply === other.reply
  })
}

/**
 * 会话头部的时间轴入口。
 * @param props - 槽位运行时 + store + 词典。
 * @returns 收藏入口；开启且有提问时渲染时间轴。
 */
export function TimelineAction({ sessionId, useChat, useSession, useSessions, useStore, actions, loadSavedQuestion, t }: TimelineActionProps) {
  const items = useChat(s => collectItems(s.order, s.nodes, t), sameTimelineItems)
  const running = useSession(s => s.running)
  const collapsed = useStore(s => s.collapsed)
  const scopeAnchor = useRef<HTMLSpanElement>(null)
  const scope = useConversationDOM(scopeAnchor)
  const navigateToItem = useQuestionNavigation(sessionId, scopeAnchor, scope !== null, loadSavedQuestion, t)
  const displayTitle = useSessions(s => s.byId[sessionId]?.displayTitle)
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())

  // 收藏标记来自全局收藏存储（含文件夹归属），按会话过滤成节点映射。
  const starredState = useSyncExternalStore(starredStore.subscribe, () => starredStore.getState())
  const starred = useMemo(() => {
    const map: Record<string, StarRecord> = {}
    for (const item of starredState.items) {
      if (item.kind === 'node' && item.sessionId === sessionId) {
        map[item.nodeKey] = { title: item.title, time: item.timestamp }
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

  // 整会话收藏（原 toggleChatStar）。
  const chatKey = sessionStarKey(sessionId)
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
        kind: 'session',
        sessionId,
        nodeKey: '',
        title: result.value.slice(0, 100),
        timestamp: Date.now(),
        folderId: result.folderId,
      })
      toast.success(t('starred.starSuccess'), null, { color: CHAT_STAR_TOAST_COLOR })
    })
  }

  const saveQuestionStar = (item: TimelineItem, title: string, folderId: string | null): void => {
    starredStore.addStar({
      key: nodeStarKey(sessionId, item.key),
      kind: 'node',
      sessionId,
      nodeKey: item.key,
      title,
      timestamp: item.time,
      folderId,
    })
    toast.success(t('starred.starSuccess'))
  }
  const removeQuestionStar = (item: TimelineItem): void => {
    starredStore.removeStar(nodeStarKey(sessionId, item.key))
  }

  const chatStarLabel = chatStarred ? t('starred.unstar') : t('starred.starChat')

  return (
    <>
      <span ref={scopeAnchor} hidden />
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
          tooltip.show('star-chat-btn', e.currentTarget, chatStarLabel, { placement: 'bottom', theme: 'inverse' })
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
      {!settings.timelineEnabled && scope !== null && items.length > 0
        ? <QuestionStarAction key={sessionId} items={items} starred={starred} onStar={saveQuestionStar} onUnstar={removeQuestionStar} t={t} />
        : null}
      {settings.timelineEnabled && scope !== null && items.length > 0
        ? createPortal(
            <TimelineRoot
              key={sessionId}
              scope={scope}
              navigateToItem={navigateToItem}
              items={items}
              starred={starred}
              pinned={pinned}
              running={running}
              collapsed={collapsed}
              onSetCollapsed={(next) => { actions.setCollapsed(next) }}
              onStar={saveQuestionStar}
              onUnstar={removeQuestionStar}
              onTogglePin={(item) => {
                pinsStore.toggle({
                  key: `${sessionId}:${item.key}`,
                  sessionId,
                  nodeKey: item.key,
                  title: item.title.slice(0, 100),
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
