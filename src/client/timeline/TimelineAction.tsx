/**
 * 会话头部入口：时间轴显隐开关按钮，并在开启时把时间轴根容器
 * portal 到 document.body（fixed 定位在会话区右侧）。
 * 数据全部来自 useSession 的 Chat 快照（无 DOM 爬取），
 * 显隐/折叠偏好与收藏标记走会话级持久化 store。
 */
import { useMemo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../locales.ts'
import { summarizeBlocks } from '../shared/text.ts'
import { settingsStore } from '../shared/settings.ts'
import { pinsStore, starredStore } from '../starred/storage.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import type { createTimelineStore, StarRecord } from './store.ts'
import { TimelineRoot } from './TimelineRoot.tsx'
import { starEditModal } from './StarModal.tsx'
import type { TimelineItem } from './TimelineBar.tsx'
import css from './timeline.module.css'

/** 整会话收藏 toast 配色（原 toggleChatStar 的 toastColor）。 */
const CHAT_STAR_TOAST_COLOR = {
  light: { backgroundColor: '#0d0d0d', textColor: '#ffffff', borderColor: '#262626' },
  dark: { backgroundColor: '#ffffff', textColor: '#1f2937', borderColor: '#d1d5db' },
}

/** 完整 props：会话头部动作槽位运行时 + 声明的 store + 词典。 */
export type TimelineActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsStore<ReturnType<typeof createTimelineStore>>
  & PropsLocale<typeof NS>

/** 计入时间轴的用户输入节点类别（提问 + 轮中追问）。 */
const USER_KINDS = new Set(['user', 'steering'])

/** 与 user/steering 节点 data 对齐的最小读取形态。 */
interface UserLikeData {
  readonly content?: readonly unknown[]
  readonly time?: number
}

function collectItems(
  order: readonly string[],
  nodes: ChatNodeStore,
  t: TranslateNS<typeof NS>,
): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || node.visibility === 'hidden' || !USER_KINDS.has(node.kind)) continue
    const data = node.data as UserLikeData
    const title = summarizeBlocks(data.content ?? [])
    items.push({
      key,
      title: title !== '' ? title : t('placeholder.attachment'),
      time: data.time ?? 0,
    })
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
  const visible = useStore(s => s.visible)
  const collapsed = useStore(s => s.collapsed)
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

  // 显示时间轴总开关（原 timelinePlatformSettings[id] === false 时整体禁用）。
  if (!settings.timelineEnabled) return null

  const toggleLabel = visible ? t('toggle.hide') : t('toggle.show')
  const chatStarLabel = chatStarred ? t('starred.unstar') : t('starred.starChat')

  return (
    <>
      <button
        type="button"
        className={visible ? `${css.headerBtn} ${css.headerBtnOn}` : css.headerBtn}
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-pressed={visible}
        onClick={() => { actions.setVisible(!visible) }}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="3" x2="12" y2="21" />
          <circle cx="12" cy="6.5" r="2.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="17.5" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      </button>
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
      </button>
      {visible && items.length > 0
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
