/**
 * 对话导出：文本类导出器（Markdown / TXT / JSON / CSV）与下载工具。
 * 移植原 conversationExport/exporters.js（CETextExporters + ceTriggerDownload），
 * 文案改由 CeTexts 注入。
 */
import {
  ceFormatChatTime, ceFormatLocalTime,
  type CeTexts, type ExportFormat, type ExportImage, type ExportJob, type ExportTurn,
} from './constants.ts'

function turnImages(turn: ExportTurn): readonly ExportImage[] {
  return [...turn.user.images, ...turn.assistant.images]
}

function imageInfoLabel(image: ExportImage, texts: CeTexts): string {
  const role = image.role === 'user' ? texts.exportRoleUser : texts.exportRoleAssistant
  // 原版真值判断：0 尺寸同样视为未知（避免输出 0x0）。
  const size = (image.width ?? 0) > 0 && (image.height ?? 0) > 0
    ? `${String(image.width)}x${String(image.height)}`
    : texts.unknownSize
  const alt = image.alt !== '' ? ` ${image.alt}` : ''
  return `${role} · ${size}${alt}`
}

/** 一张图片对应的 Markdown 行（原 _imageMarkdownLines）。 */
function imageMarkdownLines(image: ExportImage, texts: CeTexts): string[] {
  if (image.src !== '') {
    return [
      `![${image.alt}](${image.src})`,
      `> ${texts.imageListTitle}：${imageInfoLabel(image, texts)}`,
    ]
  }
  return [`> ${texts.imageListTitle}：${imageInfoLabel(image, texts)}（${texts.imageNotRendered}）`]
}

/** Markdown 导出（原 buildMarkdown）。 */
export function buildMarkdown(job: ExportJob, texts: CeTexts): string {
  const { meta, options, turns } = job
  const lines: string[] = []

  lines.push(`# ${meta.title}`)
  const headerLines: string[] = []
  if (options.showUrl && meta.url !== '') headerLines.push(`> ${texts.sourceLabel}: ${meta.url}`)
  if (options.showTime) headerLines.push(`> ${texts.timeLabel}: ${ceFormatLocalTime(meta.exportTime)}`)
  if (headerLines.length > 0) {
    lines.push('')
    lines.push(...headerLines)
  }
  lines.push('')
  lines.push('---')

  for (const turn of turns) {
    // 用户
    lines.push('')
    lines.push(`**${texts.exportRoleUser}：**`)
    const mdAskTime = options.showConversationTime ? ceFormatChatTime(turn.user.time) : ''
    if (mdAskTime !== '') {
      lines.push('')
      lines.push(`> ${texts.askTimeLabel}: ${mdAskTime}`)
    }
    lines.push('')
    lines.push(turn.user.text !== '' ? turn.user.text : texts.emptyUserPreview)

    for (const image of turn.user.images) {
      lines.push('')
      lines.push(...imageMarkdownLines(image, texts))
    }

    // 助手
    lines.push('')
    lines.push(`**${texts.exportRoleAssistant}：**`)
    const mdAsstImages = turn.assistant.images
    if (turn.assistant.markdown !== '') {
      lines.push('')
      lines.push(turn.assistant.markdown)
    } else if (mdAsstImages.length === 0) {
      // 无文本且无图片时才显示占位（纯图片回复不应提示“未找到回复内容”）。
      lines.push('')
      lines.push(texts.emptyAssistant)
    }

    for (const image of mdAsstImages) {
      lines.push('')
      lines.push(...imageMarkdownLines(image, texts))
    }

    lines.push('')
    lines.push('---')
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

/** TXT 导出（原 buildTxt）。 */
export function buildTxt(job: ExportJob, texts: CeTexts): string {
  const { meta, options, turns } = job
  const lines: string[] = []

  lines.push(meta.title)
  if (options.showUrl && meta.url !== '') lines.push(`${texts.sourceLabel}: ${meta.url}`)
  if (options.showTime) lines.push(`${texts.timeLabel}: ${ceFormatLocalTime(meta.exportTime)}`)
  lines.push('='.repeat(40))

  for (const turn of turns) {
    lines.push('')
    const txtAskTime = options.showConversationTime ? ceFormatChatTime(turn.user.time) : ''
    lines.push(txtAskTime !== '' ? `${texts.exportRoleUser}（${txtAskTime}）：` : `${texts.exportRoleUser}：`)
    lines.push(turn.user.text !== '' ? turn.user.text : texts.emptyUserPreview)
    lines.push('')
    lines.push(`${texts.exportRoleAssistant}：`)
    if (turn.assistant.text !== '') {
      lines.push(turn.assistant.text)
    } else if (turn.assistant.images.length === 0) {
      lines.push(texts.emptyAssistant)
    }

    const images = turnImages(turn)
    if (images.length > 0) {
      lines.push('')
      lines.push(`${texts.imageListTitle}：`)
      images.forEach((image, index) => {
        const tail = image.src !== '' ? image.src : `（${texts.imageNotRendered}）`
        lines.push(`  ${String(index + 1)}. [${imageInfoLabel(image, texts)}] ${tail}`)
      })
    }

    lines.push('')
    lines.push('-'.repeat(40))
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

function serializeImage(image: ExportImage): Record<string, unknown> {
  // 原版 || 归一化：空串/0 统一为 ''/null，保持 JSON 字段边界值一致。
  return {
    role: image.role,
    src: image.src || '',
    alt: image.alt || '',
    width: image.width || null,
    height: image.height || null,
    fileId: image.fileId || null,
    unrendered: !!image.unrendered,
  }
}

/** JSON 导出（原 buildJson）。 */
export function buildJson(job: ExportJob, texts: CeTexts): string {
  const { meta, options, turns } = job

  const imageCount = turns.reduce((sum, turn) => sum + turnImages(turn).length, 0)

  const metadata: Record<string, unknown> = {
    title: meta.title,
    platform: meta.platformName !== '' ? meta.platformName : meta.platformId,
    range: options.rangeId,
    format: options.formatId,
    turnCount: turns.length,
    imageCount,
  }
  if (options.showUrl && meta.url !== '') metadata.source = meta.url
  if (options.showTime) metadata.exportTime = ceFormatLocalTime(meta.exportTime)

  const conversation = turns.map(turn => ({
    order: turn.order,
    user: {
      text: turn.user.text,
      ...(options.showConversationTime && turn.user.time !== 0
        ? { time: ceFormatChatTime(turn.user.time) }
        : {}),
      images: turn.user.images.map(serializeImage),
    },
    assistant: {
      text: turn.assistant.text,
      markdown: turn.assistant.markdown,
      images: turn.assistant.images.map(serializeImage),
    },
  }))

  void texts
  return JSON.stringify({ metadata, conversation }, null, 2)
}

function csvEscape(value: string | number): string {
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV 导出（原 buildCsv）：每轮一行，RFC4180 转义 + UTF-8 BOM。
 */
export function buildCsv(job: ExportJob, texts: CeTexts): string {
  const { meta, options, turns } = job
  const withTime = options.showConversationTime

  const rows: string[] = []

  // 头部信息（标题总是输出；来源/导出时间跟随开关）。
  rows.push(`${csvEscape(texts.titleLabel)},${csvEscape(meta.title)}`)
  if (options.showUrl && meta.url !== '') {
    rows.push(`${csvEscape(texts.sourceLabel)},${csvEscape(meta.url)}`)
  }
  if (options.showTime) {
    rows.push(`${csvEscape(texts.timeLabel)},${csvEscape(ceFormatLocalTime(meta.exportTime))}`)
  }
  rows.push('')

  const header: string[] = [texts.orderLabel]
  if (withTime) header.push(texts.askTimeLabel)
  header.push(texts.exportRoleUser, texts.exportRoleAssistant, texts.imageListTitle)
  rows.push(header.map(h => csvEscape(h)).join(','))

  for (const turn of turns) {
    const cells: (string | number)[] = [turn.order]
    if (withTime) cells.push(ceFormatChatTime(turn.user.time))
    cells.push(turn.user.text)
    cells.push(turn.assistant.text !== '' ? turn.assistant.text : turn.assistant.markdown)
    const imgs = turnImages(turn)
      .map(img => (img.src !== '' ? img.src : `（${texts.imageNotRendered}）`))
      .join('\n')
    cells.push(imgs)
    rows.push(cells.map(c => csvEscape(c)).join(','))
  }

  return `\uFEFF${rows.join('\r\n')}\r\n`
}

/**
 * 触发浏览器下载（原 ceTriggerDownload）。
 * @param filenameBase - 不含扩展名的文件名（已清洗）。
 * @param format - 格式定义。
 * @param content - 文本内容或 Blob。
 */
export function ceTriggerDownload(filenameBase: string, format: ExportFormat, content: string | Blob): void {
  const blob = content instanceof Blob
    ? content
    : new Blob([content], { type: `${format.mime};charset=utf-8` })

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filenameBase}${format.ext}`
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()

  setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}
