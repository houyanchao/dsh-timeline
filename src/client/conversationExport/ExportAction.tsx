/** Conversation entry points and the shared in-page selection flow. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { NS } from '../locales.ts'
import { detectDarkTheme, observeTheme } from '../shared/theme.ts'
import { settingsStore } from '../shared/settings.ts'
import type { ChatHistory } from '../shared/history.ts'
import { panelModal } from '../panelModal/bus.ts'
import { toast } from '../ui/toast.tsx'
import { tooltip } from '../ui/tooltip.tsx'
import { SettingsIcon } from '../ui/SettingsIcon.tsx'
import timelineCss from '../timeline/timeline.module.css'
import { Bus } from '../ui/bus.ts'
import {
  CE_DEFAULT_FORMAT, CE_DEFAULT_THEME, CE_FORMATS, CE_THEMES, ceFormatText, ceSanitizeFilename,
  type CeTexts, type ExportJob,
} from './constants.ts'
import { collectAllTurns, releaseExportImages, type AttachmentResolver } from './collect.ts'
import { buildCsv, buildJson, buildMarkdown, buildTxt, ceTriggerDownload } from './exporters.ts'
import { mountedMessageElements, useSelectionLayout } from './selectionLayout.ts'
import css from './export.module.css'

type LoadHistory = (signal: AbortSignal, onPage: (history: ChatHistory) => Promise<void>) => Promise<ChatHistory | null>

export type ExportActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & {
    readonly resolveAttachment: (sessionId: string, attachmentId: string) => ReturnType<AttachmentResolver>
    readonly loadHistory: (sessionId: string, ...args: Parameters<LoadHistory>) => ReturnType<LoadHistory>
  }

interface SelectionRequest {
  readonly sessionId: string
  readonly messageId?: string
  readonly kind: 'export' | 'screenshot'
  readonly trigger: HTMLElement
}

const requests = new Bus<SelectionRequest | null>(null)
const getRequest = (): SelectionRequest | null => requests.get()
const scales = [4, 3, 2, 1]
const scaleLabels = ['export.quality1', 'export.quality2', 'export.quality3', 'export.quality4'] as const
const themeLabels = { black: 'color.black', blue: 'color.blue', purple: 'color.purple', gemini: 'color.gemini' } as const

function ActionIcon({ kind }: { readonly kind: SelectionRequest['kind'] }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === 'screenshot'
        ? <g transform="rotate(90 12 12)"><circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" /><path d="M14.8 14.8 20 20" /></g>
        : <path d="M6 22h12a2 2 0 0 0 2-2V9L13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2ZM14 2v6a1 1 0 0 0 1 1h5m-8 3v7m-3-3 3 3 3-3" />}
    </svg>
  )
}

function openSelection(request: SelectionRequest): void {
  if (requests.get()?.sessionId === request.sessionId) return
  tooltip.forceHideAll()
  requests.set(request)
}

export function AssistantExportActions({ sessionId, messageId, t }:
  PropsRuntime<'conversation.chat.assistant-actions'> & PropsLocale<typeof NS>) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
  const request = useSyncExternalStore(requests.subscribe, getRequest)
  const disabled = request?.sessionId === sessionId
  const exportLabel = t('export.label')
  const screenshotLabel = t('export.screenshotAction')
  const tooltipOptions = { placement: 'bottom', theme: 'inverse', noArrow: true } as const
  return (
    <>
      {settings.conversationExportEnabled
        ? <button type="button" className={css.replyEntry} disabled={disabled} aria-label={exportLabel}
            onMouseEnter={e => {
              if (!disabled) tooltip.show(`ce-reply-export-${sessionId}-${messageId}`, e.currentTarget, exportLabel, tooltipOptions)
            }}
            onMouseLeave={() => { tooltip.hide(true) }}
            onMouseDown={() => { tooltip.hide(true) }}
            onClick={e => { openSelection({ sessionId, messageId, kind: 'export', trigger: e.currentTarget }) }}>
            <ActionIcon kind="export" />
          </button>
        : null}
      {settings.messageScreenshotEnabled
        ? <button type="button" className={css.replyEntry} disabled={disabled} aria-label={screenshotLabel}
            onMouseEnter={e => {
              if (!disabled) tooltip.show(`ce-reply-screenshot-${sessionId}-${messageId}`, e.currentTarget, screenshotLabel, tooltipOptions)
            }}
            onMouseLeave={() => { tooltip.hide(true) }}
            onMouseDown={() => { tooltip.hide(true) }}
            onClick={e => { openSelection({ sessionId, messageId, kind: 'screenshot', trigger: e.currentTarget }) }}>
            <ActionIcon kind="screenshot" />
          </button>
        : null}
    </>
  )
}
/** t → CeTexts（原 CE_TEXT 的词典化）。 */
function buildTexts(t: ExportActionProps['t']): CeTexts {
  return {
    buttonTooltip: t('export.buttonTooltip'),
    sectionFormat: t('export.sectionFormat'),
    sectionTheme: t('export.sectionTheme'),
    headerShowTime: t('export.headerShowTime'),
    headerShowConversationTime: t('export.headerShowConversationTime'),
    askTimeLabel: t('export.askTimeLabel'),
    selectAll: t('export.selectAll'),
    exportRoleUser: 'Q',
    exportRoleAssistant: 'A',
    emptyAssistant: t('export.emptyAssistant'),
    emptyUserPreview: t('export.emptyUserPreview'),
    cancel: t('export.cancel'),
    loading: t('export.loading'),
    exporting: t('export.exporting'),
    done: t('export.done'),
    failed: t('export.failed'),
    noConversation: t('export.noConversation'),
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

export function ExportAction({ sessionId, useChat, useSession, useSessions, resolveAttachment, loadHistory, t }: ExportActionProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
  const order = useChat(s => s.order)
  const nodes = useChat(s => s.nodes)
  const hasMore = useSession(s => s.hasMore)
  const running = useSession(s => s.running)
  const displayTitle = useSessions(s => s.byId[sessionId]?.displayTitle)
  const request = useSyncExternalStore(requests.subscribe, getRequest)
  const open = request?.sessionId === sessionId
  const enabled = request?.kind === 'screenshot' ? settings.messageScreenshotEnabled : settings.conversationExportEnabled
  const texts = useMemo(() => buildTexts(t), [t])

  const close = useCallback(() => {
    if (request === null || requests.get() !== request) return
    requests.set(null)
    requestAnimationFrame(() => {
      if (request.trigger.isConnected && requests.get() === null) request.trigger.focus({ preventScroll: true })
    })
  }, [request])

  useEffect(() => {
    if (open && !enabled) close()
  }, [open, enabled, close])

  useEffect(() => () => {
    if (requests.get()?.sessionId === sessionId) requests.set(null)
  }, [sessionId])

  return (
    <>
      {settings.conversationExportEnabled
        ? <button type="button" className={`${timelineCss.headerBtn} ${css.headerEntry}`} disabled={open} aria-label={t('export.label')}
            onMouseEnter={e => {
              if (!open) tooltip.show('ce-export-btn', e.currentTarget, texts.buttonTooltip, { placement: 'bottom', theme: 'inverse' })
            }}
            onMouseLeave={() => { tooltip.hide() }}
            onClick={e => {
              if (!document.querySelector('[data-chat-flow]') || order.length === 0) {
                toast.warning(texts.noConversation)
                return
              }
              openSelection({ sessionId, kind: 'export', trigger: e.currentTarget })
            }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t('export.label')}</span>
          </button>
        : null}
      {open && enabled
        ? <MessageSelection
            key={sessionId}
            request={request}
            t={t}
            texts={texts}
            defaultThemeId={settings.activeColorId}
            title={displayTitle ?? texts.defaultTitle}
            order={order}
            nodes={nodes}
            hasMore={hasMore}
            running={running}
            resolveAttachment={id => resolveAttachment(sessionId, id)}
            loadHistory={(signal, onPage) => loadHistory(sessionId, signal, onPage)}
            onClose={close}
          />
        : null}
    </>
  )
}

interface MessageChoice {
  readonly key: string
  readonly messageId?: string
  readonly role: 'user' | 'assistant'
  readonly generating: boolean
}

function messageChoices(order: ChatHistory['order'], nodes: ChatHistory['nodes']): MessageChoice[] {
  return order.flatMap((key): MessageChoice[] => {
    const node = nodes.get(key)
    if (node === undefined || node.visibility === 'hidden') return []
    if (node.kind === 'user' || node.kind === 'steering') return [{ key, role: 'user', generating: false }]
    if (node.kind !== 'assistant-step') return []
    const data = node.data as { status?: string; finalNode?: { messageId?: string } }
    return [{ key, role: 'assistant', generating: data.status === 'running', messageId: data.finalNode?.messageId }]
  })
}

interface SelectionProps extends ChatHistory {
  readonly request: SelectionRequest
  readonly t: ExportActionProps['t']
  readonly texts: CeTexts
  readonly defaultThemeId: string
  readonly title: string
  readonly running: boolean
  readonly resolveAttachment: AttachmentResolver
  readonly loadHistory: LoadHistory
  readonly onClose: () => void
}

function Checkbox({ checked, disabled, label, title, indeterminate, onChange, focus = false }: {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly label: string
  readonly title?: string
  readonly indeterminate?: boolean
  readonly onChange: (checked: boolean) => void
  readonly focus?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate === true
  }, [indeterminate, checked])
  useLayoutEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true })
  }, [focus])
  return (
    <label className={css.check} title={title}>
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled} aria-label={label}
        onChange={e => { onChange(e.target.checked) }} />
      {title === undefined ? null : <span>{title}</span>}
    </label>
  )
}

function MessageSelection({ request, t, texts, defaultThemeId, title, order, nodes, hasMore, running,
  resolveAttachment, loadHistory, onClose }: SelectionProps) {
  const screenshot = request.kind === 'screenshot'
  const choices = useMemo(() => messageChoices(order, nodes), [order, nodes])
  const byKey = useMemo(() => new Map(choices.map((choice, index) => [choice.key, { ...choice, position: index + 1 }])), [choices])
  const keys = useMemo(() => new Set(byKey.keys()), [byKey])
  const dockRef = useRef<HTMLElement>(null)
  const layout = useSelectionLayout(dockRef, keys, onClose)
  const [dark, setDark] = useState(detectDarkTheme)
  useEffect(() => observeTheme(() => { setDark(detectDarkTheme()) }), [])

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(
    request.messageId === undefined ? [] : choices.filter(choice => choice.messageId === request.messageId && !choice.generating).map(choice => choice.key),
  ))
  const exclusions = useRef(new Set<string>())
  const historyOperation = useRef<AbortController | null>(null)
  const operation = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadNotice, setLoadNotice] = useState('')
  const [busy, setBusy] = useState<'copy' | 'download' | null>(null)
  const previous = useRef({ running, byKey })

  useEffect(() => {
    const old = previous.current
    previous.current = { running, byKey }
    if ((running && !old.running) || [...selected].some(key => old.byKey.has(key)
      && (!byKey.has(key) || byKey.get(key)?.messageId !== old.byKey.get(key)?.messageId))) {
      toast.warning(t('export.selectionChanged'))
      onClose()
    }
  }, [byKey, selected, running, onClose, t])
  useEffect(() => () => {
    historyOperation.current?.abort()
    operation.current?.abort()
  }, [])

  const saved = settingsStore.get()
  const [formatId, setFormat] = useState(CE_FORMATS.find(format => format.id === saved.exportOptions?.formatId)?.id ?? CE_DEFAULT_FORMAT)
  const [themeId, setTheme] = useState(CE_THEMES.find(theme => theme.id === saved.exportOptions?.themeId)?.id
    ?? CE_THEMES.find(theme => theme.id === defaultThemeId)?.id ?? CE_DEFAULT_THEME)
  const [pixelRatio, setScale] = useState(scales.includes(saved.screenshotScale) ? saved.screenshotScale : 2)
  const [showTime, setShowTime] = useState(saved.exportOptions?.showTime !== false)
  const [showConversationTime, setShowConversationTime] = useState(saved.exportOptions?.showConversationTime !== false)

  const eligible = choices.filter(choice => !choice.generating && layout?.mounted.has(choice.key))
  const selectedKeys = choices.filter(choice => !choice.generating && selected.has(choice.key)).map(choice => choice.key)
  const allChecked = !hasMore && eligible.length > 0 && eligible.every(choice => selected.has(choice.key))
  const isImageBased = formatId === 'png' || formatId === 'pdf'
  const canCopy = screenshot || formatId !== 'pdf'
  const locked = busy !== null || loading
  const actionLabel = t(screenshot ? 'export.screenshotAction' : 'export.label')
  const copyLabel = t(screenshot || formatId === 'png' ? 'export.copyImage' : 'export.copyContent')

  const setMessage = (key: string, checked: boolean): void => {
    if (operation.current !== null) return
    if (checked) exclusions.current.delete(key)
    else exclusions.current.add(key)
    setSelected(current => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const stopLoading = (): void => {
    historyOperation.current?.abort()
    historyOperation.current = null
    setLoading(false)
    setLoadNotice(t('export.loadingStopped'))
  }

  const selectAll = async (checked: boolean): Promise<void> => {
    if (operation.current !== null) return
    if (!checked) {
      stopLoading()
      setSelected(new Set())
      setLoadNotice('')
      return
    }
    if (historyOperation.current !== null) return
    exclusions.current.clear()
    setSelected(new Set(eligible.map(choice => choice.key)))
    setLoadNotice('')
    if (!hasMore) return

    const controller = new AbortController()
    historyOperation.current = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)])
    setLoading(true)

    const addPage = async (page: ChatHistory): Promise<void> => {
      // Let the host commit the newly loaded rows before checking their visibility.
      await new Promise<void>(resolve => { requestAnimationFrame(() => resolve()) })
      signal.throwIfAborted()
      const mounted = mountedMessageElements()
      const available = messageChoices(page.order, page.nodes).filter(choice => !choice.generating && mounted.has(choice.key))
      setSelected(current => new Set([...current, ...available.map(choice => choice.key)]
        .filter(key => !exclusions.current.has(key))))
    }

    try {
      const history = await loadHistory(signal, addPage)
      signal.throwIfAborted()
      if (history !== null) await addPage(history)
      setLoadNotice(t(history !== null && !history.hasMore ? 'export.historyLoaded' : 'export.historyIncomplete'))
    } catch {
      if (!controller.signal.aborted) setLoadNotice(t('export.historyIncomplete'))
    } finally {
      if (historyOperation.current === controller) {
        historyOperation.current = null
        setLoading(false)
      }
    }
  }

  const runExport = async (copy: boolean): Promise<void> => {
    if (selectedKeys.length === 0 || operation.current !== null || historyOperation.current !== null) return
    const controller = new AbortController()
    operation.current = controller
    const { signal } = controller
    setBusy(copy ? 'copy' : 'download')
    const filename = ceSanitizeFilename(title, texts.defaultTitle)
    const format = CE_FORMATS.find(f => f.id === (screenshot ? 'png' : formatId)) ?? CE_FORMATS[0]

    const prepare = async (): Promise<string | Blob | Blob[] | undefined> => {
      if (screenshot) {
        const mounted = mountedMessageElements()
        const elements = selectedKeys.map(key => mounted.get(key))
        if (elements.some(element => element === undefined)) throw new Error('unavailable')
        const { captureMessages } = await import('./screenshot.ts')
        return await captureMessages(elements.filter((element): element is HTMLElement => element !== undefined), pixelRatio, signal, copy)
      }

      const selectedTurns = await collectAllTurns(order, nodes, resolveAttachment, {
        selectedKeys: new Set(selectedKeys),
        shouldCancel: () => signal.aborted,
        imageEncoding: isImageBased ? 'blob' : 'data',
      })
      try {
        signal.throwIfAborted()
        if (selectedTurns.length === 0) throw new Error('unavailable')
        const job: ExportJob = {
          meta: { title, platformId: 'deepseek', platformName: 'DeepSeek', exportTime: new Date() },
          options: { showTime, showConversationTime, rangeId: 'select', formatId },
          turns: selectedTurns,
        }
        if (isImageBased) {
          const { CEPngExporter } = await import('./pngExporter.ts')
          const renderer = new CEPngExporter()
          signal.throwIfAborted()
          if (formatId === 'png') return await renderer.export(job, themeId, texts)
          const { CEPdfExporter } = await import('./pdfExporter.ts')
          signal.throwIfAborted()
          await new CEPdfExporter().export(job, themeId, texts, renderer, signal)
          return
        }
        if (formatId === 'markdown') return buildMarkdown(job, texts)
        if (formatId === 'txt') return buildTxt(job, texts)
        if (formatId === 'csv') return buildCsv(job, texts)
        return buildJson(job, texts)
      } finally {
        releaseExportImages(selectedTurns)
      }
    }

    try {
      const output = prepare()
      if (copy) {
        const mime = screenshot || formatId === 'png' ? 'image/png' : 'text/plain'
        if (typeof ClipboardItem === 'undefined' && mime === 'text/plain') {
          const value = await output
          signal.throwIfAborted()
          if (typeof value !== 'string') throw new Error('copy-failed')
          await navigator.clipboard.writeText(value)
        } else {
          const data = output.then(value => {
            signal.throwIfAborted()
            if (Array.isArray(value) && value.length === 1) return value[0]
            if (value instanceof Blob) return value
            if (typeof value === 'string') return new Blob([value], { type: mime })
            throw new Error('copy-failed')
          })
          // Start the clipboard write while the original click still grants access.
          let write: Promise<void>
          try { write = navigator.clipboard.write([new ClipboardItem({ [mime]: data })]) }
          catch (error) { write = Promise.reject(error) }
          const [prepared, written] = await Promise.allSettled([data, write])
          if (prepared.status === 'rejected') throw prepared.reason
          if (written.status === 'rejected') throw written.reason
        }
      } else {
        const value = await output
        signal.throwIfAborted()
        if (Array.isArray(value)) {
          value.forEach((blob, index) => ceTriggerDownload(
            value.length === 1 ? filename : `${filename}-${index + 1}`, format, blob,
          ))
        } else if (value !== undefined) ceTriggerDownload(filename, format, value)
      }

      if (signal.aborted) return
      if (screenshot) settingsStore.set({ screenshotScale: pixelRatio })
      else settingsStore.set({ exportOptions: { formatId, themeId, showTime, showConversationTime } })
      toast.success(copy ? t('export.copied') : texts.done)
      if (!copy) onClose()
    } catch (error) {
      if (signal.aborted) return
      const code = error instanceof Error ? error.message : ''
      if (code === 'copy-too-long') {
        toast.warning(t('export.copyTooLong'))
      } else if (screenshot && code === 'unavailable') {
        toast.warning(t('export.messageUnavailable'))
      } else if (screenshot && code === 'image-unavailable') {
        toast.warning(t('export.screenshotImageUnavailable'))
      } else if (screenshot && code === 'capture-too-large') {
        toast.warning(t('export.screenshotTooLarge'))
      } else {
        toast.error(copy ? t('export.copyFailed') : texts.failed)
      }
    } finally {
      operation.current = null
      if (!signal.aborted) setBusy(null)
    }
  }


  return createPortal(
    <div className={css.selection} data-dsh-timeline-selection="" data-dsh-timeline-ui="" data-theme={dark ? 'dark' : 'light'}>
      <section className={css.dock} ref={dockRef} aria-label={actionLabel} style={layout === null
        ? undefined : { left: layout.center, width: layout.width, bottom: layout.bottom }}>
        <div className={css.heading}>
          <div className={css.identity}>
            <div className={css.titleGroup}>
              <strong>{actionLabel}</strong>
              <button type="button" className={`${css.iconButton} ${css.settingsButton}`}
                title={t('export.actionSettings')} aria-label={t('export.actionSettings')} aria-haspopup="dialog"
                onClick={() => { panelModal.show('export') }}>
                <SettingsIcon />
              </button>
            </div>
            {loadNotice === '' ? null : <span className={css.status} role="status">{loadNotice}</span>}
          </div>
          <button type="button" className={css.iconButton} title={texts.cancel} aria-label={texts.cancel} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className={css.options}>
          {screenshot
            ? <label className={css.field}>
                <span>{t('export.resolution')}</span>
                <select value={pixelRatio} disabled={busy !== null} onChange={e => { setScale(Number(e.target.value)) }}>
                  {scales.map(ratio => <option key={ratio} value={ratio}>{t(scaleLabels[ratio - 1])} ({ratio}×)</option>)}
                </select>
              </label>
            : <>
                <div className={css.fields}>
                  <label className={css.field}>
                    <span>{texts.sectionFormat}</span>
                    <select value={formatId} disabled={busy !== null} onChange={e => { setFormat(e.target.value) }}>
                      {CE_FORMATS.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}
                    </select>
                  </label>
                  {isImageBased ? <label className={css.field}>
                    <span>{texts.sectionTheme}</span>
                    <select value={themeId} disabled={busy !== null} onChange={e => { setTheme(e.target.value) }}>
                      {CE_THEMES.map(theme => <option key={theme.id} value={theme.id}>{t(themeLabels[theme.id as keyof typeof themeLabels])}</option>)}
                    </select>
                  </label> : null}
                </div>
                <div className={css.metadata} role="group" aria-label={t('export.headerOptions')}>
                  <span className={css.status}>{t('export.headerOptions')}</span>
                  <Checkbox checked={showTime} disabled={busy !== null} label={texts.headerShowTime} title={texts.headerShowTime} onChange={setShowTime} />
                  <Checkbox checked={showConversationTime} disabled={busy !== null} label={texts.headerShowConversationTime}
                    title={texts.headerShowConversationTime} onChange={setShowConversationTime} />
                </div>
              </>}
        </div>

        <div className={css.footer}>
          <div className={css.selectionTools}>
            <Checkbox focus checked={allChecked} indeterminate={!allChecked && selectedKeys.length > 0}
              disabled={busy !== null} label={texts.selectAll} title={texts.selectAll}
              onChange={checked => { void selectAll(checked) }} />
            <span className={css.status} role="status">
              {ceFormatText(t('export.selectedCount'), { count: selectedKeys.length, total: eligible.length })}
            </span>
          </div>
          <div className={css.buttons}>
            {canCopy ? <button type="button" className={css.button} disabled={locked || selectedKeys.length === 0} aria-label={copyLabel}
              aria-busy={busy === 'copy'} onClick={() => { void runExport(true) }}>
              {busy === 'copy' ? t('export.copying') : copyLabel}
            </button> : null}
            <button type="button" className={`${css.button} ${css.primary}`} disabled={locked || selectedKeys.length === 0}
              aria-label={t(screenshot ? 'export.downloadScreenshot' : 'export.download')} aria-busy={busy === 'download'}
              onClick={() => { void runExport(false) }}>
              {busy === 'download' ? texts.exporting : t(screenshot ? 'export.downloadScreenshot' : 'export.download')}
            </button>
          </div>
        </div>
      </section>

      {loading ? <div className={css.loadingNotice} role="status">
        <span className={css.spinner} aria-hidden />
        <div><strong>{texts.loading}</strong><div>{ceFormatText(t('export.loadedCount'), { count: eligible.length })}</div></div>
        <button type="button" className={css.button} onClick={stopLoading}>{t('export.stopLoading')}</button>
      </div> : null}

      {layout !== null && layout.extraScrollSpace > 0
        ? createPortal(<div className={css.spacer} data-dsh-timeline-ui="" aria-hidden style={{ height: layout.extraScrollSpace }} />, layout.flow)
        : null}

      {layout?.markers.map(marker => {
        const choice = byKey.get(marker.key)
        if (choice === undefined) return null
        const checked = selected.has(marker.key)
        return (
          <div key={marker.key} className={css.marker} data-message-key={marker.key} data-selected={checked}>
            <div className={css.outline} style={marker.outline} aria-hidden />
            <div className={css.markerControl} style={{ left: marker.left, top: marker.top }}>
              <Checkbox checked={checked} disabled={busy !== null || choice.generating}
                label={`${t(choice.role === 'user' ? 'export.selectQuestion' : 'export.selectReply')} ${choice.position}`}
                onChange={checked => { setMessage(marker.key, checked) }} />
            </div>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
