/**
 * 对话导出入口：会话头部「导出」按钮 + 导出弹窗
 * （移植原 CEExportManager + CEExportModal）。
 * 点击后打开弹窗（加载态）→ 从会话快照采集轮次（图片经 readAttachment 解析）
 * → 展示设置区与对话选择列表 → 按格式导出（MD/TXT/JSON/CSV/PNG/PDF）。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { settingsStore } from '../shared/settings.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import {
  CE_DEFAULT_FORMAT, CE_DEFAULT_THEME, CE_FORMATS, CE_THEMES,
  ceFormatText, ceSanitizeFilename,
  type CeTexts, type ExportJob, type ExportTurn,
} from './constants.ts'
import { collectAllTurns, type AttachmentResolver } from './collect.ts'
import { buildCsv, buildJson, buildMarkdown, buildTxt, ceTriggerDownload } from './exporters.ts'
import { CEPngExporter } from './pngExporter.ts'
import { CEPdfExporter } from './pdfExporter.ts'
import css from './export.module.css'

/** 完整 props：会话头部动作槽位运行时 + 词典 + 注入的图片解析器。 */
export type ExportActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & {
    /** 会话图片字节解析（ctx.sessions.binding(id).session.readAttachment）。 */
    readonly resolveAttachment: (sessionId: string, attachmentId: string) => Promise<{
      readonly mediaType: string
      readonly width: number
      readonly height: number
      readonly name?: string
      readonly data: Uint8Array
    } | null>
  }

/** t → CeTexts（原 CE_TEXT 的词典化）。 */
function buildTexts(t: ExportActionProps['t']): CeTexts {
  return {
    buttonTooltip: t('export.buttonTooltip'),
    modalTitle: t('export.modalTitle'),
    sectionRange: t('export.sectionRange'),
    sectionFormat: t('export.sectionFormat'),
    sectionTheme: t('export.sectionTheme'),
    sectionList: t('export.sectionList'),
    rangeAll: t('export.rangeAll'),
    rangeSelect: t('export.rangeSelect'),
    headerShowUrl: t('export.headerShowUrl'),
    headerShowTime: t('export.headerShowTime'),
    headerShowConversationTime: t('export.headerShowConversationTime'),
    askTimeLabel: t('export.askTimeLabel'),
    selectAll: t('export.selectAll'),
    turnPrefix: t('export.turnPrefix'),
    exportRoleUser: 'Q',
    exportRoleAssistant: 'A',
    emptyAssistant: t('export.emptyAssistant'),
    emptyUserPreview: t('export.emptyUserPreview'),
    cancel: t('export.cancel'),
    confirm: t('export.confirm'),
    loading: t('export.loading'),
    loadingProgress: t('export.loadingProgress'),
    cancelLoading: t('export.cancelLoading'),
    exporting: t('export.exporting'),
    done: t('export.done'),
    failed: t('export.failed'),
    noConversation: t('export.noConversation'),
    needSelect: t('export.needSelect'),
    sourceLabel: t('export.sourceLabel'),
    timeLabel: t('export.timeLabel'),
    titleLabel: t('export.titleLabel'),
    orderLabel: t('export.orderLabel'),
    imageCannotEmbed: t('export.imageCannotEmbed'),
    imageNotRendered: t('export.imageNotRendered'),
    truncatedNotice: t('export.truncatedNotice'),
    imageListTitle: t('export.imageListTitle'),
    defaultTitle: t('export.defaultTitle'),
    unknownSize: t('export.unknownSize'),
  }
}

/** 列表行预览截断（原 _preview）。 */
function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean
}

/**
 * 会话头部导出入口。
 * @param props - 槽位运行时 + 词典 + 图片解析器。
 * @returns 导出按钮；设置关闭时不渲染。
 */
export function ExportAction({ sessionId, useSession, useSessions, resolveAttachment, t }: ExportActionProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get())
  const chatOrder = useSession(s => s.chat.order)
  const nodes = useSession(s => s.chat.nodes)
  const displayTitle = useSessions(s => s.byId[sessionId]?.displayTitle)

  const [open, setOpen] = useState(false)
  const texts = useMemo(() => buildTexts(t), [t])

  // 会话切换时强制关闭弹窗（原 url:change 分支的等价物）。
  const prevSessionRef = useRef(sessionId)
  useEffect(() => {
    if (prevSessionRef.current === sessionId) return
    prevSessionRef.current = sessionId
    setOpen(false)
  }, [sessionId])

  if (!settings.conversationExportEnabled) return null

  return (
    <>
      <button
        type="button"
        className={css.exportBtn}
        aria-label={t('export.label')}
        onClick={() => {
          if (open) return
          if (chatOrder.length === 0) {
            toast.error(texts.noConversation)
            return
          }
          setOpen(true)
        }}
        onMouseEnter={(e) => {
          tooltip.show('ce-export-btn', e.currentTarget, texts.buttonTooltip, { placement: 'bottom' })
        }}
        onMouseLeave={() => { tooltip.hide() }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>{t('export.label')}</span>
      </button>
      {open
        ? (
          <ExportModal
            texts={texts}
            themeLabels={{
              black: t('color.black'),
              blue: t('color.blue'),
              purple: t('color.purple'),
              gemini: t('color.gemini'),
            }}
            defaultThemeId={settings.activeColorId}
            title={displayTitle ?? texts.defaultTitle}
            chatOrder={chatOrder}
            nodes={nodes}
            resolveAttachment={(attachmentId) => resolveAttachment(sessionId, attachmentId)}
            onClose={() => { setOpen(false) }}
          />
        )
        : null}
    </>
  )
}

interface ExportModalProps {
  readonly texts: CeTexts
  /** 主题色 id → 本地化名称。 */
  readonly themeLabels: Readonly<Record<string, string>>
  readonly defaultThemeId: string
  readonly title: string
  readonly chatOrder: readonly string[]
  readonly nodes: Parameters<typeof collectAllTurns>[1]
  readonly resolveAttachment: AttachmentResolver
  readonly onClose: () => void
}

/** 导出弹窗（原 CEExportModal 的 React 化）。 */
function ExportModal({ texts, themeLabels, defaultThemeId, title, chatOrder, nodes, resolveAttachment, onClose }: ExportModalProps) {
  const [dark, setDark] = useState(() => detectDarkTheme())
  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'content'>('loading')
  const [progress, setProgress] = useState(0)
  const [turns, setTurns] = useState<readonly ExportTurn[]>([])
  const [exporting, setExporting] = useState(false)

  const [rangeId, setRangeId] = useState<'all' | 'select'>('all')
  const [formatId, setFormatId] = useState(CE_DEFAULT_FORMAT)
  const [themeId, setThemeId] = useState(
    CE_THEMES.some(th => th.id === defaultThemeId) ? defaultThemeId : CE_DEFAULT_THEME,
  )
  const [showUrl, setShowUrl] = useState(true)
  const [showTime, setShowTime] = useState(true)
  const [showConversationTime, setShowConversationTime] = useState(true)
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set())

  const cancelledRef = useRef(false)
  const closedRef = useRef(false)
  const closingRef = useRef(false)

  /** 关闭：先移除 visible 类淡出 0.2s，再卸载（原 close() 的退场路径，全部关闭途径共用）。 */
  const requestClose = (): void => {
    if (closingRef.current) return
    closingRef.current = true
    setVisible(false)
    setTimeout(onClose, 200)
  }

  // 入场动画
  useEffect(() => {
    const raf = requestAnimationFrame(() => { setVisible(true) })
    return () => { cancelAnimationFrame(raf) }
  }, [])

  // ESC 关闭（capture，原 _onKeydown）
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    }
    document.addEventListener('keydown', onKeydown, true)
    return () => { document.removeEventListener('keydown', onKeydown, true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 加载对话（原 _loadConversation）
  useEffect(() => {
    closedRef.current = false
    void (async () => {
      let collected: ExportTurn[] = []
      try {
        collected = await collectAllTurns(chatOrder, nodes, resolveAttachment, {
          onProgress: (count) => { setProgress(count) },
          shouldCancel: () => cancelledRef.current || closedRef.current,
        })
      } catch { /* 加载失败按空处理 */ }

      if (closedRef.current) return
      if (cancelledRef.current) {
        requestClose()
        return
      }
      if (collected.length === 0) {
        toast.error(texts.noConversation)
        requestClose()
        return
      }
      setTurns(collected)
      setPhase('content')
    })()
    return () => { closedRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 范围切换：整个会话=全选禁用；选择对话=清空可交互（原 _syncRangeUI）。
  useEffect(() => {
    if (rangeId === 'all') setChecked(new Set(turns.map((_, i) => i)))
    else setChecked(new Set())
  }, [rangeId, turns])

  const isSelect = rangeId === 'select'
  const isImageBased = formatId === 'png' || formatId === 'pdf'
  const selectedCount = checked.size
  const exportEnabled = turns.length > 0 && (!isSelect || selectedCount > 0)

  const toggleRow = (index: number): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const runExport = async (): Promise<void> => {
    // 收集导出请求（原 getExportRequest：重新编号保持序号连续）。
    const selectedTurns = (isSelect ? turns.filter((_, i) => checked.has(i)) : [...turns])
      .map((turn, index) => ({ ...turn, order: index + 1 }))

    if (selectedTurns.length === 0) {
      toast.warning(texts.needSelect)
      return
    }

    setExporting(true)

    try {
      const format = CE_FORMATS.find(f => f.id === formatId) ?? CE_FORMATS[0]
      const job: ExportJob = {
        meta: {
          title,
          platformId: 'deepseek',
          platformName: 'DeepSeek',
          url: location.href,
          exportTime: new Date(),
        },
        options: { showUrl, showTime, showConversationTime, rangeId, formatId },
        turns: selectedTurns,
      }

      const filenameBase = ceSanitizeFilename(job.meta.title, texts.defaultTitle)

      if (formatId === 'png') {
        const blob = await new CEPngExporter().export(job, themeId, texts)
        ceTriggerDownload(filenameBase, format, blob)
      } else if (formatId === 'pdf') {
        // 文字排版方案：构建 HTML → 浏览器打印为 PDF（复用 PNG 的 markdown 解析）
        await new CEPdfExporter().export(job, themeId, texts, new CEPngExporter())
      } else {
        let content: string
        if (formatId === 'markdown') content = buildMarkdown(job, texts)
        else if (formatId === 'txt') content = buildTxt(job, texts)
        else if (formatId === 'csv') content = buildCsv(job, texts)
        else content = buildJson(job, texts)
        ceTriggerDownload(filenameBase, format, content)
      }

      toast.success(texts.done)
      requestClose()
    } catch {
      toast.error(texts.failed)
      setExporting(false)
    }
  }

  return createPortal(
    <div
      className={visible ? `${css.overlay} ${css.visible}` : css.overlay}
      data-theme={dark ? 'dark' : 'light'}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div className={css.modal}>
        {/* ===== Header ===== */}
        <div className={css.header}>
          <h3>{texts.modalTitle}</h3>
          <button type="button" className={css.close} aria-label={texts.cancel} onClick={requestClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* ===== Loading ===== */}
        {phase === 'loading'
          ? (
            <div className={css.loading}>
              <div className={css.spinner} />
              <div className={css.loadingText}>
                {progress > 0 ? ceFormatText(texts.loadingProgress, { count: progress }) : texts.loading}
              </div>
              <button
                type="button"
                className={css.loadingCancel}
                onClick={() => {
                  cancelledRef.current = true
                  requestClose()
                }}
              >
                {texts.cancelLoading}
              </button>
            </div>
          )
          : (
            <>
              {/* ===== Content ===== */}
              <div className={css.content}>
                {/* 范围 / 格式 / 主题色 */}
                <div className={`${css.section} ${css.sectionRange}`}>
                  <div className={css.fieldRow}>
                    <div className={css.field}>
                      <div className={css.sectionTitle}>{texts.sectionRange}</div>
                      <select
                        className={css.select}
                        value={rangeId}
                        onChange={(e) => { setRangeId(e.target.value === 'select' ? 'select' : 'all') }}
                      >
                        <option value="all">{texts.rangeAll}</option>
                        <option value="select">{texts.rangeSelect}</option>
                      </select>
                    </div>
                    <div className={css.field}>
                      <div className={css.sectionTitle}>{texts.sectionFormat}</div>
                      <select
                        className={css.select}
                        value={formatId}
                        onChange={(e) => { setFormatId(e.target.value) }}
                      >
                        {CE_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                    </div>
                    {/* 图片主题色：仅 PNG / PDF 时显示 */}
                    <div className={css.field} style={isImageBased ? undefined : { display: 'none' }}>
                      <div className={css.sectionTitle}>{texts.sectionTheme}</div>
                      <select
                        className={css.select}
                        value={themeId}
                        onChange={(e) => { setThemeId(e.target.value) }}
                      >
                        {CE_THEMES.map(th => (
                          <option key={th.id} value={th.id}>
                            {/* 调色板 label 词典化（原 CE_THEMES.label） */}
                            {themeLabels[th.id] ?? th.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 更多配置（对话 URL / 导出时间 / 对话时间） */}
                <div className={css.section}>
                  <div className={css.checkGroup}>
                    <label className={css.check}>
                      <input type="checkbox" checked={showUrl} onChange={(e) => { setShowUrl(e.target.checked) }} />
                      <span>{texts.headerShowUrl}</span>
                    </label>
                    <label className={css.check}>
                      <input type="checkbox" checked={showTime} onChange={(e) => { setShowTime(e.target.checked) }} />
                      <span>{texts.headerShowTime}</span>
                    </label>
                    <label className={css.check}>
                      <input type="checkbox" checked={showConversationTime} onChange={(e) => { setShowConversationTime(e.target.checked) }} />
                      <span>{texts.headerShowConversationTime}</span>
                    </label>
                  </div>
                </div>

                {/* 选择对话列表 */}
                <div className={[css.section, css.listSection, isSelect ? '' : css.disabled].filter(Boolean).join(' ')}>
                  <div className={css.sectionTitle}>{texts.sectionList}</div>
                  <label className={`${css.check} ${css.selectAll}`}>
                    <input
                      type="checkbox"
                      disabled={!isSelect}
                      checked={selectedCount > 0 && selectedCount === turns.length}
                      ref={(el) => {
                        if (el !== null) el.indeterminate = selectedCount > 0 && selectedCount < turns.length
                      }}
                      onChange={(e) => {
                        setChecked(e.target.checked ? new Set(turns.map((_, i) => i)) : new Set())
                      }}
                    />
                    <span>{texts.selectAll}</span>
                  </label>
                  <div className={css.list}>
                    {turns.map((turn, index) => (
                      <label key={turn.order} className={css.listItem}>
                        <div className={css.listAside}>
                          <input
                            type="checkbox"
                            className={css.listCheck}
                            disabled={!isSelect}
                            checked={checked.has(index)}
                            onChange={() => { toggleRow(index) }}
                          />
                          <div className={css.listOrder}>{`${texts.turnPrefix} ${String(turn.order)}`}</div>
                        </div>
                        <div className={css.listBody}>
                          <div className={`${css.listPreview} ${css.listUser}`}>
                            {`${texts.exportRoleUser}：${preview(turn.user.text) !== '' ? preview(turn.user.text) : texts.emptyUserPreview}`}
                          </div>
                          <div className={`${css.listPreview} ${css.listAssistant}`}>
                            {`${texts.exportRoleAssistant}：${preview(turn.assistant.text) !== '' ? preview(turn.assistant.text) : texts.emptyAssistant}`}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* ===== Footer ===== */}
              <div className={css.footer}>
                <button type="button" className={`${css.btn} ${css.btnCancel}`} onClick={requestClose}>
                  {texts.cancel}
                </button>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnConfirm}`}
                  disabled={exporting || !exportEnabled}
                  onClick={() => { void runExport() }}
                >
                  {exporting ? texts.exporting : texts.confirm}
                </button>
              </div>
            </>
          )}
      </div>
    </div>,
    document.body,
  )
}
