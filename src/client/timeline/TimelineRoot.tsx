/**
 * 时间轴根容器：还原原扩展的 wrapper 布局（fixed 右侧，顶部问题列表按钮 +
 * 轴条），以及三项全局交互——右缘折叠按钮（hover 时浮现）、问题列表与
 * 轴条互斥切换、上下方向键导航到上/下一个提问。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { settingsStore } from '../shared/settings.ts'
import { tooltip } from '../ui/tooltip.tsx'
import { ACTIVE_COLOR_PALETTE, paletteEntryToCss } from '../shared/palette.ts'
import { playAiCompleteSound, removeAiCompleteAnchor, showAiCompleteToast, stopAiCompleteSound } from '../shared/aiCompleteReminder.ts'
import { pendingNavigateStore } from '../starred/storage.ts'
import { LAYOUT, smoothScrollTo } from './engine.ts'
import type { StarRecord } from './store.ts'
import { TimelineBar, findMessageElement, findScrollContainer, type TimelineItem } from './TimelineBar.tsx'
import { QuestionListPanel } from './QuestionListPanel.tsx'
import { StarModal } from './StarModal.tsx'
import { TimeLabels } from './TimeLabels.tsx'
import { NotepadButton, notepad } from '../notepad/NotepadPanel.tsx'
import css from './timeline.module.css'

/** 根容器 props（由 TimelineAction 传入，纯数据 + 回调）。 */
export interface TimelineRootProps {
  readonly sessionId: string
  readonly items: readonly TimelineItem[]
  readonly starred: Record<string, StarRecord>
  /** 已标记图钉的节点 key 集合。 */
  readonly pinned: ReadonlySet<string>
  /** AI 是否正在生成（完成提醒的触发信号）。 */
  readonly running: boolean
  readonly collapsed: boolean
  readonly onSetCollapsed: (collapsed: boolean) => void
  /** 添加收藏（弹窗确认后携带自定义标题与所属文件夹）。 */
  readonly onStar: (item: TimelineItem, title: string, folderId: string | null) => void
  /** 取消收藏。 */
  readonly onUnstar: (item: TimelineItem) => void
  /** 切换图钉标记。 */
  readonly onTogglePin: (item: TimelineItem) => void
  readonly t: TranslateNS<typeof NS>
}

/** 判断当前焦点是否落在可编辑元素上（方向键导航需要让位）。 */
function isEditableFocused(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable
    || el.tagName === 'INPUT'
    || el.tagName === 'TEXTAREA'
    || el.tagName === 'SELECT'
    || el.tagName === 'IFRAME'
}

/**
 * 时间轴根容器。
 * @param props - 提问节点、收藏集、折叠状态与回调。
 * @returns wrapper + 折叠按钮（portal 到 body 的 fixed 布局由外层完成）。
 */
export function TimelineRoot({ sessionId, items, starred, pinned, running, collapsed, onSetCollapsed, onStar, onUnstar, onTogglePin, t }: TimelineRootProps) {
  const [dark, setDark] = useState(() => detectDarkTheme())
  const [listOpen, setListOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [toggleVisible, setToggleVisible] = useState(false)
  /** 折叠按钮 3s 自动隐藏定时器（原 _autoHideTimer）。 */
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const btnHoveredRef = useRef(false)
  const wrapperHoveredRef = useRef(false)
  /** 待收藏节点（非空时显示收藏弹窗，对应原版 starInputModal.show）。 */
  const [starTarget, setStarTarget] = useState<TimelineItem | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  const arrowNavEnabledRef = useRef(settings.arrowKeysNavEnabled)
  arrowNavEnabledRef.current = settings.arrowKeysNavEnabled

  // 主题跟随宿主（原版 syncDarkModeClass 的等价物）。
  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  const scrollToItem = useCallback((key: string) => {
    const port = findScrollContainer()
    const el = findMessageElement(key)
    if (port !== null && el !== null) {
      setActiveKey(key)
      smoothScrollTo(port, el)
    }
  }, [])

  // 跨会话导航后的待滚动目标（收藏树 setNavigateDataForUrl 的 DSH 等价物）：
  // 节点出现在列表里时消费并滚动。
  useEffect(() => {
    const tryConsume = (): void => {
      const pending = pendingNavigateStore.get()
      if (pending === null || pending.sessionId !== sessionId) return
      if (!itemsRef.current.some(item => item.key === pending.nodeKey)) return
      const key = pendingNavigateStore.consume(sessionId)
      if (key !== null) scrollToItem(key)
    }
    tryConsume()
    return pendingNavigateStore.subscribe(tryConsume)
  }, [sessionId, items, scrollToItem])

  // 星标点击：已收藏直接取消；未收藏先弹窗输入主题（原版 toggleStarByDotId）。
  const handleToggleStar = useCallback((item: TimelineItem) => {
    if (starred[item.key] !== undefined) {
      onUnstar(item)
    } else {
      setStarTarget(item)
    }
  }, [starred, onUnstar])

  // 上下方向键导航（移植原版 onKeyDown：可编辑元素让位；无激活节点时
  // ↑ 从最后一个开始、↓ 从第一个开始；边界处保持不动）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      // 设置面板的 ↑/↓ 导航开关（原 arrowKeysNavigationEnabled）。
      if (!arrowNavEnabledRef.current) return
      if (isEditableFocused()) return
      const list = itemsRef.current
      if (list.length === 0) return

      const currentIndex = list.findIndex(item => item.key === activeKeyRef.current)
      let target: TimelineItem | undefined
      if (currentIndex === -1) {
        target = e.key === 'ArrowUp' ? list[list.length - 1] : list[0]
      } else if (e.key === 'ArrowUp') {
        if (currentIndex - 1 < 0) return
        target = list[currentIndex - 1]
      } else {
        if (currentIndex + 1 >= list.length) return
        target = list[currentIndex + 1]
      }
      if (target !== undefined) {
        e.preventDefault()
        scrollToItem(target.key)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [scrollToItem])

  // ==== 折叠按钮显隐（移植原 setupToggleButtonHover）====

  /** 仅当消息右缘距视口右边 < 200px 时才在 hover 时显示收起按钮（原 shouldShowCollapseButton）。 */
  const shouldShowCollapse = useCallback((): boolean => {
    const first = itemsRef.current[0]
    if (first === undefined) return true
    const el = findMessageElement(first.key)
    if (el === null) return true
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return true
    return window.innerWidth - rect.right < 200
  }, [])

  const clearAutoHide = useCallback(() => {
    if (autoHideTimerRef.current !== null) {
      clearTimeout(autoHideTimerRef.current)
      autoHideTimerRef.current = null
    }
  }, [])

  /** 3s 后自动隐藏（若鼠标不在按钮上，原 _autoHideTimer）。 */
  const startAutoHide = useCallback(() => {
    clearAutoHide()
    autoHideTimerRef.current = setTimeout(() => {
      autoHideTimerRef.current = null
      if (!btnHoveredRef.current) setToggleVisible(false)
    }, 3000)
  }, [clearAutoHide])

  useEffect(() => clearAutoHide, [clearAutoHide])

  const onWrapperEnter = useCallback(() => {
    wrapperHoveredRef.current = true
    if (!collapsed && shouldShowCollapse()) {
      clearAutoHide()
      setToggleVisible(true)
      startAutoHide()
    }
  }, [collapsed, shouldShowCollapse, clearAutoHide, startAutoHide])

  const onWrapperLeave = useCallback(() => {
    wrapperHoveredRef.current = false
    // 延迟 50ms，避免鼠标移向按钮时闪烁（原 mouseleave 分支）。
    setTimeout(() => {
      if (!btnHoveredRef.current) setToggleVisible(false)
    }, 50)
  }, [])

  const onToggleBtnEnter = useCallback((el: HTMLElement) => {
    btnHoveredRef.current = true
    clearAutoHide()
    tooltip.show(
      'timeline-toggle',
      el,
      collapsed ? t('collapse.expand') : t('collapse.collapse'),
      { placement: 'left', showDelay: 200 },
    )
  }, [collapsed, clearAutoHide, t])

  const onToggleBtnLeave = useCallback(() => {
    btnHoveredRef.current = false
    tooltip.hide()
    if (wrapperHoveredRef.current) {
      startAutoHide()
    } else {
      setToggleVisible(false)
    }
  }, [startAutoHide])

  // 时间轴收起时关闭闪记面板（原 timeline-manager 折叠分支行为）。
  useEffect(() => {
    if (collapsed && notepad.isOpen()) notepad.close()
  }, [collapsed])

  // 闪记开关关闭时收起面板（原 notepad-toggle 关闭分支）。
  useEffect(() => {
    if (!settings.notepadEnabled && notepad.isOpen()) notepad.close()
  }, [settings.notepadEnabled])

  // AI 回复完成提醒（原 onAIStateChange → scheduleAICompleteToastCheck）：
  // 生成结束 200ms 后，若用户停留在非最后节点，弹右上角胶囊 toast / 播放提示音。
  const prevRunningRef = useRef(running)
  useEffect(() => {
    const wasRunning = prevRunningRef.current
    prevRunningRef.current = running
    if (!wasRunning || running) return

    const timer = setTimeout(() => {
      const current = settingsStore.get()
      if (!current.aiCompleteToastEnabled && !current.aiCompleteSoundEnabled) return
      const list = itemsRef.current
      if (list.length <= 1) return
      const activeId = activeKeyRef.current
      const activeIndex = activeId !== null ? list.findIndex(item => item.key === activeId) : -1
      // 停留在最后节点说明用户正在看最新回复，不打扰；
      // 无激活节点（-1）时原版会提醒，保持一致。
      if (activeIndex >= list.length - 1) return

      if (current.aiCompleteToastEnabled) {
        showAiCompleteToast(t('timeline.aiCompleteToast').replace('{name}', 'DeepSeek'))
      }
      if (current.aiCompleteSoundEnabled) playAiCompleteSound()
    }, 200)
    return () => { clearTimeout(timer) }
  }, [running, t])

  // 卸载时移除完成提醒锚点并停止提示音（原 destroy 分支：removeAnchor + aiCompleteAudio.pause）。
  useEffect(() => () => {
    removeAiCompleteAnchor()
    stopAiCompleteSound()
  }, [])

  const theme = dark ? 'dark' : 'light'

  // 激活色（原 timelineActiveColors[platform] → CSS 变量注入）。
  // 仅浅色主题生效：深色下用户选色（尤其黑色）容易沉进背景，
  // 不注入、统一走样式表深色档的固定激活色。
  const activeEntry = ACTIVE_COLOR_PALETTE.find(entry => entry.id === settings.activeColorId)
  const activeColorStyle = !dark && activeEntry !== undefined
    ? { '--tl-dot-active-color': paletteEntryToCss(activeEntry) } as React.CSSProperties
    : undefined

  return (
    <div className={css.root} data-dsh-tl-theme={theme} style={activeColorStyle}>
      {settings.chatTimeLabelEnabled ? <TimeLabels items={items} dark={dark} /> : null}
      <div
        className={collapsed ? `${css.wrapper} ${css.wrapperCollapsed}` : css.wrapper}
        data-dsh-tl-wrapper
        onPointerEnter={onWrapperEnter}
        onPointerLeave={onWrapperLeave}
      >
        {listOpen
          ? (
            <QuestionListPanel
              items={items}
              starred={starred}
              pinned={pinned}
              activeKey={activeKey}
              onJump={scrollToItem}
              onToggleStar={handleToggleStar}
              onTogglePin={onTogglePin}
              onClose={() => { setListOpen(false) }}
              t={t}
            />
          )
          : (
            <TimelineBar
              items={items}
              starred={starred}
              pinned={pinned}
              activeKey={activeKey}
              running={running}
              onActiveChange={setActiveKey}
              onJump={scrollToItem}
              onToggleStar={handleToggleStar}
              onTogglePin={onTogglePin}
              t={t}
            />
          )}
        {/* 问题列表按钮（原 ait-question-list-btn：位于轴条下方、闪记按钮之上） */}
        <button
          type="button"
          className={listOpen ? `${css.questionListBtn} ${css.questionListBtnActive}` : css.questionListBtn}
          title={t('list.open')}
          aria-label={t('list.open')}
          aria-pressed={listOpen}
          onPointerDown={(event) => { event.stopPropagation() }}
          onClick={() => { setListOpen(open => !open) }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
        {/* 闪记入口按钮（原 ait-notepad-btn：位于轴条下方，开关控制显隐） */}
        {settings.notepadEnabled ? <NotepadButton t={t} /> : null}
      </div>
      {starTarget !== null
        ? (
          <StarModal
            defaultValue={starTarget.title}
            onConfirm={({ value, folderId }) => {
              onStar(starTarget, value, folderId)
              setStarTarget(null)
            }}
            onCancel={() => { setStarTarget(null) }}
            t={t}
          />
        )
        : null}
      <button
        type="button"
        className={[
          css.toggleBtn,
          collapsed ? css.toggleBtnCollapsed : '',
          toggleVisible ? css.toggleBtnVisible : '',
        ].filter(Boolean).join(' ')}
        aria-label={collapsed ? t('collapse.expand') : t('collapse.collapse')}
        onPointerEnter={(e) => { onToggleBtnEnter(e.currentTarget) }}
        onPointerLeave={onToggleBtnLeave}
        onClick={() => {
          tooltip.hide(true)
          onSetCollapsed(!collapsed)
        }}
      >
        {collapsed
          ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          )
          : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )}
      </button>
    </div>
  )
}
