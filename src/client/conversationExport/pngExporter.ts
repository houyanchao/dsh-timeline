/**
 * 对话导出：PNG 导出器（移植原 conversationExport/png-exporter.js）。
 * 无第三方库，纯 Canvas 绘制一张完整长图：
 * - 头部主题色区：标题、来源、导出时间
 * - 正文：逐轮渲染用户/助手内容（段落、标题、列表、引用、代码块、图片）
 * - 图片：尝试内嵌，失败显示占位提示
 * - 公式：页面存在 MathJax（tex2svg）时渲染为 SVG 图片，否则回退 LaTeX 文本
 * - 超长对话：超过画布上限时截断并提示
 */
import {
  CE_MAX_CANVAS_HEIGHT, ceFormatChatTime, ceFormatLocalTime, ceGetTheme,
  type CeTexts, type ExportJob, type ExportImage, type ExportTheme,
} from './constants.ts'

/** 一个可绘制操作：高度 + 绘制函数（原 op 结构）。 */
interface PaintOp {
  readonly height: number
  /** 首行中心相对 op 顶部的偏移（左侧 Q/A 标记对齐用）。 */
  readonly markerCenter?: number
  paint: (c: CanvasRenderingContext2D, y: number) => void
}

interface FontSpec {
  readonly size: number
  readonly weight?: string
  readonly mono?: boolean
}

interface LoadedImage {
  readonly element: HTMLImageElement | null
  readonly width?: number
  readonly height?: number
}

/** 公式图片条目。 */
interface FormulaEntry {
  readonly element: HTMLImageElement
  readonly width: number
  readonly height: number
}

/** markdown 轻量块（原 _parseMarkdownBlocks 输出）。 */
export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'listitem'; depth: number; ordered: boolean; index: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'formula'; latex: string }

type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'formula'; latex: string }

type InlineItem =
  | { type: 'text'; text: string; w: number }
  | { type: 'formula'; entry: FormulaEntry | null; w: number; h: number; fallback: string }

/** window.MathJax 的最小读取形态。 */
interface MathJaxLike {
  startup?: { promise?: Promise<unknown> }
  tex2svg?: (latex: string, options: { display: boolean }) => Element
}

function getMathJax(): MathJaxLike | null {
  const mj = (window as { MathJax?: MathJaxLike }).MathJax
  return typeof mj === 'object' ? mj : null
}

export class CEPngExporter {
  private readonly PAGE_WIDTH = 820
  private readonly PADDING_X = 40
  private readonly contentWidth = this.PAGE_WIDTH - this.PADDING_X * 2
  /** 正文区左右留白（原 BODY_PADDING_X）。 */
  private readonly BODY_PADDING_X = 24
  /** 左侧 Q/A 标记栏宽（原 MARKER_GUTTER）。 */
  private readonly MARKER_GUTTER = 38
  private readonly contentX = this.BODY_PADDING_X + this.MARKER_GUTTER
  private readonly bodyWidth = this.PAGE_WIDTH - this.contentX - this.BODY_PADDING_X
  private readonly IMAGE_LOAD_TIMEOUT = 8000
  private readonly MAX_IMAGE_HEIGHT = 460

  private readonly fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif'
  private readonly monoFamily = '"SF Mono", "Cascadia Code", Consolas, "Courier New", monospace'

  private readonly colors = {
    bg: '#ffffff',
    text: '#1f2937',
    subtle: '#6b7280',
    userBg: '#f3f4f6',
    codeBg: '#f6f8fa',
    codeText: '#24292e',
    quoteBar: '#d1d5db',
    divider: '#e5e7eb',
    placeholderBg: '#f3f4f6',
    placeholderText: '#9ca3af',
  }

  private texts!: CeTexts
  private formulaCapable = false
  private formulaImages = new Map<string, FormulaEntry | null>()
  private mathjaxReady: Promise<boolean> | null = null

  /** 导出 PNG（原 export）。 */
  async export(job: ExportJob, themeId: string, texts: CeTexts): Promise<Blob> {
    const canvas = await this.renderCanvas(job, themeId, texts)
    return await this.canvasToBlob(canvas)
  }

  /** 渲染整张长图到 canvas（原 renderCanvas，供 PNG / PDF 复用）。 */
  async renderCanvas(job: ExportJob, themeId: string, texts: CeTexts): Promise<HTMLCanvasElement> {
    this.texts = texts
    const theme = ceGetTheme(themeId)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const measureCanvas = document.createElement('canvas')
    const measureCtx = measureCanvas.getContext('2d')
    if (measureCtx === null) throw new Error('canvas 2d context unavailable')

    // 预加载图片
    const imageMap = await this.preloadImages(job.turns.flatMap(t => [...t.user.images, ...t.assistant.images]))

    // 仅在导出内容实际包含公式时探测公式渲染能力
    const hasFormulas = job.turns.some(turn => this.collectFormulas(turn.assistant.markdown).length > 0)
    this.formulaCapable = hasFormulas ? await this.probeFormulaRendering() : false
    this.formulaImages = this.formulaCapable
      ? await this.preloadFormulas(job)
      : new Map()

    // 构建绘制操作（含测量高度）
    const headerBlock = this.buildHeader(measureCtx, job)
    const bodyOps = this.buildBodyOps(measureCtx, job, imageMap, theme)

    // 计算高度并处理截断
    const { ops, totalHeight, truncated } = this.layout(headerBlock.height, bodyOps)

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(this.PAGE_WIDTH * dpr)
    canvas.height = Math.round(totalHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('canvas 2d context unavailable')
    ctx.scale(dpr, dpr)
    ctx.textBaseline = 'top'

    // 背景
    ctx.fillStyle = this.colors.bg
    ctx.fillRect(0, 0, this.PAGE_WIDTH, totalHeight)

    // 头部
    headerBlock.paint(ctx, 0, theme)

    // 正文
    let y = headerBlock.height
    for (const op of ops) {
      op.paint(ctx, y)
      y += op.height
    }

    if (truncated) this.paintTruncationNotice(ctx, y)

    return canvas
  }

  // ==================== 布局/截断 ====================

  private layout(headerHeight: number, bodyOps: readonly PaintOp[]): { ops: PaintOp[]; totalHeight: number; truncated: boolean } {
    const maxBody = CE_MAX_CANVAS_HEIGHT - headerHeight - 80
    const ops: PaintOp[] = []
    let used = 0
    let truncated = false

    for (const op of bodyOps) {
      if (used + op.height > maxBody) {
        truncated = true
        break
      }
      ops.push(op)
      used += op.height
    }

    const bottomPadding = 32
    const noticeSpace = truncated ? 56 : 0
    const totalHeight = Math.ceil(headerHeight + used + bottomPadding + noticeSpace)
    return { ops, totalHeight, truncated }
  }

  private paintTruncationNotice(ctx: CanvasRenderingContext2D, y: number): void {
    this.setFont(ctx, { size: 14, weight: '500' })
    ctx.fillStyle = this.colors.subtle
    ctx.textAlign = 'center'
    ctx.fillText(this.texts.truncatedNotice, this.PAGE_WIDTH / 2, y + 16)
    ctx.textAlign = 'left'
  }

  // ==================== 头部 ====================

  private buildHeader(ctx: CanvasRenderingContext2D, job: ExportJob): {
    height: number
    paint: (c: CanvasRenderingContext2D, top: number, themeDef: ExportTheme) => void
  } {
    const padX = this.PADDING_X
    const padTop = 32
    const innerWidth = this.contentWidth

    this.setFont(ctx, { size: 24, weight: '700' })
    const titleLines = this.wrapText(ctx, job.meta.title, innerWidth)

    const metaLines: string[] = []
    if (job.options.showUrl && job.meta.url !== '') {
      metaLines.push(`${this.texts.sourceLabel}: ${job.meta.url}`)
    }
    if (job.options.showTime) {
      metaLines.push(`${this.texts.timeLabel}: ${ceFormatLocalTime(job.meta.exportTime)}`)
    }

    const titleLineHeight = 32
    const metaLineHeight = 20
    const gap = metaLines.length > 0 ? 14 : 0
    const height = padTop + titleLines.length * titleLineHeight + gap
      + metaLines.length * metaLineHeight + 28

    return {
      height,
      paint: (c, top, themeDef) => {
        this.fillThemeBackground(c, top, height, themeDef)

        c.fillStyle = themeDef.textColor
        c.textAlign = 'left'

        let cursor = top + padTop
        this.setFont(c, { size: 24, weight: '700' })
        for (const line of titleLines) {
          c.fillText(line, padX, cursor)
          cursor += titleLineHeight
        }

        if (metaLines.length > 0) {
          cursor += gap - 6
          this.setFont(c, { size: 13, weight: '400' })
          c.globalAlpha = 0.9
          for (const line of metaLines) {
            const clipped = this.clipToWidth(c, line, innerWidth)
            c.fillText(clipped, padX, cursor)
            cursor += metaLineHeight
          }
          c.globalAlpha = 1
        }
      },
    }
  }

  private fillThemeBackground(ctx: CanvasRenderingContext2D, top: number, height: number, theme: ExportTheme): void {
    if (theme.gradient !== undefined) {
      // 135deg 渐变
      const grad = ctx.createLinearGradient(0, top, this.PAGE_WIDTH, top + height)
      theme.gradient.forEach(([offset, color]) => { grad.addColorStop(offset, color) })
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = theme.solid ?? '#0d0d0d'
    }
    ctx.fillRect(0, top, this.PAGE_WIDTH, height)
  }

  // ==================== 正文 ====================

  private buildBodyOps(
    ctx: CanvasRenderingContext2D,
    job: ExportJob,
    imageMap: Map<string, LoadedImage>,
    theme: ExportTheme,
  ): PaintOp[] {
    const ops: PaintOp[] = []

    // 正文与顶部主题区之间留出间距
    ops.push(this.spacerOp(18))

    job.turns.forEach((turn, index) => {
      if (index > 0) ops.push(this.dividerOp())

      // 提问：首个内容块（气泡）挂上左侧「Q」标记
      const askTime = job.options.showConversationTime ? ceFormatChatTime(turn.user.time) : ''
      const userOp = this.userTextOp(ctx, turn.user.text !== '' ? turn.user.text : this.texts.emptyUserPreview, askTime)
      ops.push(this.withRoleMarker(userOp, this.texts.exportRoleUser, true, theme))
      for (const image of turn.user.images) {
        ops.push(this.imageOp(image, imageMap))
      }

      ops.push(this.spacerOp(10))

      // 回答：文本块 + 图片
      const assistantOps: PaintOp[] = []
      const blocks = this.parseMarkdownBlocks(turn.assistant.markdown)
      if (blocks.length > 0) {
        for (const block of blocks) assistantOps.push(this.markdownBlockOp(ctx, block))
      } else if (turn.assistant.text !== '') {
        assistantOps.push(this.paragraphOp(ctx, turn.assistant.text))
      }
      for (const image of turn.assistant.images) {
        assistantOps.push(this.imageOp(image, imageMap))
      }
      // 文本与图片都没有时才显示占位提示
      if (assistantOps.length === 0) {
        assistantOps.push(this.paragraphOp(ctx, this.texts.emptyAssistant))
      }
      assistantOps[0] = this.withRoleMarker(assistantOps[0], this.texts.exportRoleAssistant, false, theme)
      for (const op of assistantOps) ops.push(op)
    })

    return ops
  }

  private spacerOp(height: number): PaintOp {
    return { height, paint() { /* 纯占位间距 */ } }
  }

  /** 给内容块 op 附加左侧「Q / A」圆形标记（原 _withRoleMarker）。 */
  private withRoleMarker(op: PaintOp, letter: string, isQuestion: boolean, theme: ExportTheme): PaintOp {
    const center = op.markerCenter ?? 16
    const origPaint = op.paint.bind(op)
    return {
      height: op.height,
      markerCenter: op.markerCenter,
      paint: (c, y) => {
        origPaint(c, y)
        this.paintRoleMarker(c, y + center, letter, isQuestion, theme)
      },
    }
  }

  private paintRoleMarker(c: CanvasRenderingContext2D, centerY: number, letter: string, isQuestion: boolean, theme: ExportTheme): void {
    const r = 14
    const cx = this.BODY_PADDING_X + r

    let bg = '#e5e7eb'
    let fg = '#4b5563'
    if (isQuestion) {
      bg = theme.gradient !== undefined ? theme.gradient[0][1] : theme.solid ?? '#6128ff'
      fg = '#ffffff'
    }

    c.beginPath()
    c.arc(cx, centerY, r, 0, Math.PI * 2)
    c.fillStyle = bg
    c.fill()

    this.setFont(c, { size: 14, weight: '700' })
    c.fillStyle = fg
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(letter, cx, centerY + 0.5)
    c.textAlign = 'left'
    c.textBaseline = 'top'
  }

  private dividerOp(): PaintOp {
    return {
      height: 33,
      paint: (c, y) => {
        c.strokeStyle = this.colors.divider
        c.lineWidth = 1
        c.beginPath()
        c.moveTo(this.BODY_PADDING_X, y + 16)
        c.lineTo(this.PAGE_WIDTH - this.BODY_PADDING_X, y + 16)
        c.stroke()
      },
    }
  }

  private userTextOp(ctx: CanvasRenderingContext2D, text: string, timeText = ''): PaintOp {
    const padding = 14
    const lineHeight = 22
    const timeHeight = timeText !== '' ? 20 : 0
    this.setFont(ctx, { size: 15, weight: '400' })
    const lines = this.wrapText(ctx, text, this.bodyWidth - padding * 2)
    const boxHeight = lines.length * lineHeight + padding * 2 + timeHeight

    return {
      height: boxHeight + 10,
      // 顶部第一行中心（有时间则为时间行），用于左侧 Q 标记对齐
      markerCenter: padding + (timeHeight !== 0 ? timeHeight : lineHeight) / 2,
      paint: (c, y) => {
        const boxTop = y
        this.roundRect(c, this.contentX, boxTop, this.bodyWidth, boxHeight, 10)
        c.fillStyle = this.colors.userBg
        c.fill()

        c.textAlign = 'left'
        let textTop = boxTop + padding

        // 提问时间：小号浅色，置于气泡顶部
        if (timeText !== '') {
          this.setFont(c, { size: 12, weight: '400' })
          c.fillStyle = this.colors.subtle
          c.textBaseline = 'top'
          c.fillText(timeText, this.contentX + padding, textTop)
          textTop += timeHeight
        }

        this.setFont(c, { size: 15, weight: '400' })
        c.fillStyle = this.colors.text
        c.textBaseline = 'middle'
        let cursor = textTop + lineHeight / 2
        for (const line of lines) {
          c.fillText(line, this.contentX + padding, cursor)
          cursor += lineHeight
        }
        c.textBaseline = 'top'
      },
    }
  }

  private paragraphOp(ctx: CanvasRenderingContext2D, text: string): PaintOp {
    return this.richTextOp(ctx, text, {
      font: { size: 15, weight: '400' },
      lineHeight: 23,
      topPad: 4,
      bottomPad: 6,
    })
  }

  /**
   * 通用富文本块渲染（原 _richTextOp）：支持内联公式混排、
   * 可选列表标记 / 引用竖条 / 缩进。
   */
  private richTextOp(ctx: CanvasRenderingContext2D, rawText: string, opts: {
    font: FontSpec
    lineHeight?: number
    color?: string
    indent?: number
    marker?: string | null
    markerDx?: number
    topPad?: number
    bottomPad?: number
    quoteBar?: boolean
  }): PaintOp {
    const font = opts.font
    const lineHeight = opts.lineHeight ?? 23
    const color = opts.color ?? this.colors.text
    const indent = opts.indent ?? 0
    const marker = opts.marker ?? null
    const markerDx = opts.markerDx ?? 0
    const topPad = opts.topPad ?? 4
    const bottomPad = opts.bottomPad ?? 6
    const quoteBar = opts.quoteBar === true

    const maxWidth = this.bodyWidth - indent
    const tokens = this.tokenizeInline(rawText)
    const hasFormula = tokens.some(t => t.type === 'formula')

    let lines: InlineItem[][]
    if (hasFormula) {
      lines = this.layoutInline(ctx, tokens, maxWidth, font)
    } else {
      const plain = tokens.map(t => (t.type === 'text' ? t.text : '')).join('')
      this.setFont(ctx, font)
      lines = this.wrapText(ctx, plain, maxWidth).map(t => [{ type: 'text', text: t, w: 0 }])
    }

    const innerHeight = lines.length * lineHeight
    return {
      height: innerHeight + topPad + bottomPad,
      markerCenter: topPad + lineHeight / 2,
      paint: (c, y) => {
        c.textAlign = 'left'
        if (quoteBar) {
          c.fillStyle = this.colors.quoteBar
          c.fillRect(this.contentX, y + topPad, 3, innerHeight)
        }
        if (marker !== null) {
          this.setFont(c, font)
          c.fillStyle = color
          c.fillText(marker, this.contentX + markerDx, y + topPad)
        }
        let cursor = y + topPad
        const startX = this.contentX + indent
        for (const line of lines) {
          let cx = startX
          for (const item of line) {
            if (item.type === 'formula' && item.entry !== null) {
              try {
                c.drawImage(item.entry.element, cx, cursor + (lineHeight - item.h) / 2 - 2, item.w, item.h)
              } catch {
                this.setFont(c, font)
                c.fillStyle = color
                c.fillText(item.fallback, cx, cursor)
              }
            } else if (item.type === 'formula') {
              this.setFont(c, font)
              c.fillStyle = color
              c.fillText(item.fallback, cx, cursor)
            } else {
              this.setFont(c, font)
              c.fillStyle = color
              c.fillText(item.text, cx, cursor)
            }
            cx += item.w
          }
          cursor += lineHeight
        }
      },
    }
  }

  /** 含内联公式的文本切分为 token（原 _tokenizeInline）。 */
  private tokenizeInline(rawText: string): InlineToken[] {
    const tokens: InlineToken[] = []
    const re = /\$([^$\n]+?)\$/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(rawText)) !== null) {
      if (m.index > last) {
        tokens.push({ type: 'text', text: this.cleanInline(rawText.slice(last, m.index)) })
      }
      tokens.push({ type: 'formula', latex: m[1].trim() })
      last = re.lastIndex
    }
    if (last < rawText.length) {
      tokens.push({ type: 'text', text: this.cleanInline(rawText.slice(last)) })
    }
    return tokens
  }

  /** 行内混排布局：文本按字符换行，公式作为整体盒子换行（原 _layoutInline）。 */
  private layoutInline(ctx: CanvasRenderingContext2D, tokens: readonly InlineToken[], maxWidth: number, font: FontSpec): InlineItem[][] {
    const inlineH = Math.round(font.size * 1.15)
    const lines: InlineItem[][] = []
    let line: InlineItem[] = []
    let x = 0
    const pushLine = (): void => { lines.push(line); line = []; x = 0 }

    for (const token of tokens) {
      if (token.type === 'text') {
        this.setFont(ctx, font)
        for (const ch of token.text) {
          const cw = ctx.measureText(ch).width
          if (x + cw > maxWidth && line.length > 0) pushLine()
          const lastItem = line[line.length - 1]
          if (lastItem !== undefined && lastItem.type === 'text') {
            lastItem.text += ch
            lastItem.w += cw
          } else {
            line.push({ type: 'text', text: ch, w: cw })
          }
          x += cw
        }
      } else {
        const key = `I:${token.latex}`
        const entry = this.formulaCapable ? this.formulaImages.get(key) ?? null : null
        let w: number
        const h = inlineH
        if (entry !== null) {
          w = entry.width * (inlineH / entry.height)
        } else {
          this.setFont(ctx, font)
          w = ctx.measureText(token.latex).width
        }
        if (x + w > maxWidth && line.length > 0) pushLine()
        line.push({ type: 'formula', entry, w, h, fallback: token.latex })
        x += w
      }
    }
    if (line.length > 0) pushLine()
    return lines
  }

  private markdownBlockOp(ctx: CanvasRenderingContext2D, block: MarkdownBlock): PaintOp {
    switch (block.kind) {
      case 'heading': return this.headingOp(ctx, block)
      case 'listitem': return this.listItemOp(ctx, block)
      case 'quote': return this.quoteOp(ctx, block)
      case 'code': return this.codeOp(ctx, block)
      case 'formula': return this.formulaBlockOp(ctx, block)
      default: return this.paragraphOp(ctx, block.text)
    }
  }

  private formulaBlockOp(ctx: CanvasRenderingContext2D, block: { latex: string }): PaintOp {
    const key = `D:${block.latex}`
    const entry = this.formulaCapable ? this.formulaImages.get(key) ?? null : null

    if (entry !== null) {
      let w = entry.width
      let h = entry.height
      if (w > this.bodyWidth) {
        const ratio = this.bodyWidth / w
        w = this.bodyWidth
        h = h * ratio
      }
      return {
        height: h + 24,
        markerCenter: 12 + h / 2,
        paint: (c, y) => {
          const x = this.contentX + (this.bodyWidth - w) / 2
          try {
            c.drawImage(entry.element, x, y + 12, w, h)
          } catch {
            this.paintCenteredText(c, y, block.latex)
          }
        },
      }
    }

    // 回退：居中显示 LaTeX 文本
    const lineHeight = 23
    this.setFont(ctx, { size: 15, weight: '400' })
    const lines = this.wrapText(ctx, block.latex, this.bodyWidth)
    return {
      height: lines.length * lineHeight + 16,
      markerCenter: 8 + lineHeight / 2,
      paint: (c, y) => {
        this.setFont(c, { size: 15, weight: '400' })
        c.fillStyle = this.colors.text
        c.textAlign = 'center'
        let cursor = y + 8
        for (const line of lines) {
          c.fillText(line, this.contentX + this.bodyWidth / 2, cursor)
          cursor += lineHeight
        }
        c.textAlign = 'left'
      },
    }
  }

  private paintCenteredText(ctx: CanvasRenderingContext2D, y: number, text: string): void {
    this.setFont(ctx, { size: 15, weight: '400' })
    ctx.fillStyle = this.colors.text
    ctx.textAlign = 'center'
    ctx.fillText(text, this.contentX + this.bodyWidth / 2, y + 12)
    ctx.textAlign = 'left'
  }

  private headingOp(ctx: CanvasRenderingContext2D, block: { level: number; text: string }): PaintOp {
    const size = block.level <= 1 ? 20 : block.level === 2 ? 18 : 16
    return this.richTextOp(ctx, block.text, {
      font: { size, weight: '700' },
      lineHeight: size + 8,
      topPad: 8,
      bottomPad: 4,
    })
  }

  private listItemOp(ctx: CanvasRenderingContext2D, block: { depth: number; ordered: boolean; index: number; text: string }): PaintOp {
    const marker = block.ordered ? `${String(block.index)}.` : '•'
    return this.richTextOp(ctx, block.text, {
      font: { size: 15, weight: '400' },
      lineHeight: 23,
      indent: 22 + block.depth * 18,
      marker,
      markerDx: block.depth * 18,
      topPad: 3,
      bottomPad: 3,
    })
  }

  private quoteOp(ctx: CanvasRenderingContext2D, block: { text: string }): PaintOp {
    return this.richTextOp(ctx, block.text, {
      font: { size: 15, weight: '400' },
      lineHeight: 23,
      indent: 18,
      color: this.colors.subtle,
      quoteBar: true,
      topPad: 2,
      bottomPad: 10,
    })
  }

  private codeOp(ctx: CanvasRenderingContext2D, block: { code: string }): PaintOp {
    const padding = 14
    const lineHeight = 20
    this.setFont(ctx, { size: 13, mono: true })
    const rawLines = block.code.split('\n')
    const wrapped: string[] = []
    for (const line of rawLines) {
      const parts = this.wrapText(ctx, line !== '' ? line : ' ', this.bodyWidth - padding * 2)
      wrapped.push(...(parts.length > 0 ? parts : ['']))
    }
    const boxHeight = wrapped.length * lineHeight + padding * 2

    return {
      height: boxHeight + 12,
      markerCenter: padding + lineHeight / 2,
      paint: (c, y) => {
        this.roundRect(c, this.contentX, y, this.bodyWidth, boxHeight, 8)
        c.fillStyle = this.colors.codeBg
        c.fill()

        this.setFont(c, { size: 13, mono: true })
        c.fillStyle = this.colors.codeText
        c.textAlign = 'left'
        let cursor = y + padding
        for (const line of wrapped) {
          c.fillText(line, this.contentX + padding, cursor)
          cursor += lineHeight
        }
      },
    }
  }

  private imageOp(image: ExportImage, imageMap: Map<string, LoadedImage>): PaintOp {
    const entry = imageMap.get(image.src)

    if (entry !== undefined && entry.element !== null) {
      const el = entry.element
      // 原版 || 语义：0 尺寸兜底到 1，避免除零产生 NaN 布局。
      const naturalW = entry.width || el.naturalWidth || 1
      const naturalH = entry.height || el.naturalHeight || 1
      const drawWidth = Math.min(naturalW, this.bodyWidth)
      let drawHeight = (naturalH / naturalW) * drawWidth
      let finalWidth = drawWidth
      if (drawHeight > this.MAX_IMAGE_HEIGHT) {
        const ratio = this.MAX_IMAGE_HEIGHT / drawHeight
        drawHeight = this.MAX_IMAGE_HEIGHT
        finalWidth = drawWidth * ratio
      }
      return {
        height: drawHeight + 16,
        markerCenter: 8 + 14,
        paint: (c, y) => {
          try {
            c.drawImage(el, this.contentX, y + 8, finalWidth, drawHeight)
          } catch {
            this.paintImagePlaceholder(c, y)
          }
        },
      }
    }

    return {
      height: 56,
      markerCenter: 8 + 14,
      paint: (c, y) => { this.paintImagePlaceholder(c, y) },
    }
  }

  private paintImagePlaceholder(ctx: CanvasRenderingContext2D, y: number): void {
    const height = 40
    this.roundRect(ctx, this.contentX, y + 8, this.bodyWidth, height, 8)
    ctx.fillStyle = this.colors.placeholderBg
    ctx.fill()
    this.setFont(ctx, { size: 13, weight: '400' })
    ctx.fillStyle = this.colors.placeholderText
    ctx.textAlign = 'center'
    ctx.fillText(this.texts.imageCannotEmbed, this.contentX + this.bodyWidth / 2, y + 8 + height / 2 - 7)
    ctx.textAlign = 'left'
  }

  // ==================== Markdown 轻量解析（原 _parseMarkdownBlocks） ====================

  parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = []
    if (markdown === '') return blocks

    const lines = markdown.split('\n')
    let i = 0
    let paragraph: string[] = []

    const flushParagraph = (): void => {
      if (paragraph.length > 0) {
        // 保留原始文本（含内联 $...$），清洗与公式切分留到渲染时处理
        const raw = paragraph.join(' ').trim()
        if (raw !== '') blocks.push({ kind: 'paragraph', text: raw })
        paragraph = []
      }
    }

    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      // 代码块
      const fence = /^```(.*)$/.exec(trimmed)
      if (fence !== null) {
        flushParagraph()
        const lang = fence[1].trim()
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i])
          i++
        }
        i++ // 跳过结束 fence
        blocks.push({ kind: 'code', lang, code: codeLines.join('\n') })
        continue
      }

      // 独立公式块：$$ 独占一行作为起止围栏
      if (trimmed === '$$') {
        flushParagraph()
        const formulaLines: string[] = []
        i++
        while (i < lines.length && lines[i].trim() !== '$$') {
          formulaLines.push(lines[i])
          i++
        }
        i++ // 跳过结束 $$
        blocks.push({ kind: 'formula', latex: formulaLines.join('\n').trim() })
        continue
      }

      if (trimmed === '') {
        flushParagraph()
        i++
        continue
      }

      // 标题
      const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
      if (heading !== null) {
        flushParagraph()
        blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
        i++
        continue
      }

      // 分隔线
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph()
        i++
        continue
      }

      // 引用
      const quote = /^\s*>\s?(.*)$/.exec(line)
      if (quote !== null) {
        flushParagraph()
        const quoteText = [quote[1]]
        i++
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteText.push(lines[i].replace(/^\s*>\s?/, ''))
          i++
        }
        blocks.push({ kind: 'quote', text: quoteText.join(' ').trim() })
        continue
      }

      // 列表项
      const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line)
      if (listMatch !== null) {
        flushParagraph()
        const depth = Math.min(Math.floor(listMatch[1].length / 2), 4)
        const ordered = /\d+\./.test(listMatch[2])
        const index = ordered ? parseInt(listMatch[2], 10) : 0
        blocks.push({ kind: 'listitem', depth, ordered, index, text: listMatch[3].trim() })
        i++
        continue
      }

      // 普通段落（累积连续行）
      paragraph.push(trimmed)
      i++
    }

    flushParagraph()
    return blocks
  }

  /** 去除 markdown 内联标记（原 _cleanInline）。 */
  private cleanInline(text: string): string {
    return text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/(^|[^\w])_([^_]+)_($|[^\w])/g, '$1$2$3')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // ==================== 图片预加载 ====================

  private async preloadImages(images: readonly ExportImage[]): Promise<Map<string, LoadedImage>> {
    const srcs = new Set<string>()
    for (const img of images) {
      if (img.src !== '') srcs.add(img.src)
    }

    const map = new Map<string, LoadedImage>()
    await Promise.all(Array.from(srcs).map(async (src) => {
      const result = await this.loadImage(src)
      map.set(src, result)
    }))
    return map
  }

  private loadImage(src: string): Promise<LoadedImage> {
    return new Promise((resolve) => {
      const img = new Image()
      let settled = false
      const finish = (value: LoadedImage): void => {
        if (settled) return
        settled = true
        resolve(value)
      }

      const timer = setTimeout(() => { finish({ element: null }) }, this.IMAGE_LOAD_TIMEOUT)

      img.crossOrigin = 'anonymous'
      img.onload = () => {
        clearTimeout(timer)
        finish({ element: img, width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = () => {
        clearTimeout(timer)
        finish({ element: null })
      }

      try {
        img.src = src
      } catch {
        clearTimeout(timer)
        finish({ element: null })
      }
    })
  }

  // ==================== 公式渲染（LaTeX → SVG 图片） ====================

  /** 探测公式图片渲染是否可用且不污染 canvas（原 _probeFormulaRendering）。 */
  private async probeFormulaRendering(): Promise<boolean> {
    try {
      const entry = await this.renderLatexToImage('x^2', false)
      if (entry === null) return false
      const test = document.createElement('canvas')
      test.width = 4
      test.height = 4
      const tctx = test.getContext('2d')
      if (tctx === null) return false
      tctx.drawImage(entry.element, 0, 0, 4, 4)
      test.toDataURL() // 若画布被污染会抛出 SecurityError
      return true
    } catch {
      return false
    }
  }

  /** 预渲染选中对话中出现的全部公式（去重，原 _preloadFormulas）。 */
  private async preloadFormulas(job: ExportJob): Promise<Map<string, FormulaEntry | null>> {
    const map = new Map<string, FormulaEntry | null>()
    if (!this.formulaCapable) return map

    const seen = new Set<string>()
    const items: { key: string; latex: string; display: boolean }[] = []
    for (const turn of job.turns) {
      for (const f of this.collectFormulas(turn.assistant.markdown)) {
        const key = (f.display ? 'D:' : 'I:') + f.latex
        if (!seen.has(key)) {
          seen.add(key)
          items.push({ key, latex: f.latex, display: f.display })
        }
      }
    }

    await Promise.all(items.map(async (item) => {
      const entry = await this.renderLatexToImage(item.latex, item.display)
      map.set(item.key, entry)
    }))
    return map
  }

  /** 从 markdown 收集公式（原 _collectFormulas）。 */
  collectFormulas(markdown: string): { latex: string; display: boolean }[] {
    const result: { latex: string; display: boolean }[] = []
    if (markdown === '') return result

    let m: RegExpExecArray | null
    const displayRe = /\$\$([\s\S]+?)\$\$/g
    while ((m = displayRe.exec(markdown)) !== null) {
      const latex = m[1].trim()
      if (latex !== '') result.push({ latex, display: true })
    }

    const inlineSource = markdown.replace(/\$\$[\s\S]+?\$\$/g, ' ')
    const inlineRe = /\$([^$\n]+?)\$/g
    while ((m = inlineRe.exec(inlineSource)) !== null) {
      const latex = m[1].trim()
      if (latex !== '') result.push({ latex, display: false })
    }
    return result
  }

  /** MathJax 就绪检测（原 _ensureMathJax；DSH 下仅用页面已存在的 MathJax）。 */
  async ensureMathJax(): Promise<boolean> {
    this.mathjaxReady ??= (async () => {
      try {
        const mj = getMathJax()
        if (mj === null) return false
        if (mj.startup?.promise !== undefined) {
          await mj.startup.promise
        }
        return typeof mj.tex2svg === 'function'
      } catch {
        return false
      }
    })()
    const ready = await this.mathjaxReady
    if (!ready) this.mathjaxReady = null
    return ready
  }

  /** LaTeX → 自包含 SVG → 图片（原 _renderLatexToImage）。 */
  private async renderLatexToImage(latex: string, displayMode: boolean): Promise<FormulaEntry | null> {
    if (latex === '') return null

    const ready = await this.ensureMathJax()
    if (!ready) return null

    const fontSize = displayMode ? 22 : 17
    const color = this.colors.text

    let svg: SVGElement | null
    try {
      const mj = getMathJax()
      if (mj?.tex2svg === undefined) return null
      const node = mj.tex2svg(latex, { display: displayMode })
      svg = node.querySelector('svg')
    } catch {
      return null
    }
    if (svg === null) return null

    // 在真实 DOM 中按目标字号测量像素尺寸（MathJax SVG 默认使用 ex 单位）
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;font-size:${String(fontSize)}px;`
    probe.appendChild(svg)
    document.body.appendChild(probe)
    const rect = svg.getBoundingClientRect()
    const width = Math.max(1, Math.ceil(rect.width))
    const height = Math.max(1, Math.ceil(rect.height))

    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.style.color = color // MathJax 字形使用 currentColor
    const svgString = new XMLSerializer().serializeToString(svg)
    probe.remove()

    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
    return await new Promise((resolve) => {
      const img = new Image()
      let settled = false
      const finish = (value: FormulaEntry | null): void => {
        if (!settled) { settled = true; resolve(value) }
      }
      const timer = setTimeout(() => { finish(null) }, 5000)
      img.onload = () => { clearTimeout(timer); finish({ element: img, width, height }) }
      img.onerror = () => { clearTimeout(timer); finish(null) }
      try {
        img.src = url
      } catch {
        clearTimeout(timer)
        finish(null)
      }
    })
  }

  // ==================== Canvas 工具 ====================

  private setFont(ctx: CanvasRenderingContext2D, { size, weight = '400', mono = false }: FontSpec): void {
    const family = mono ? this.monoFamily : this.fontFamily
    ctx.font = `${weight} ${String(size)}px ${family}`
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = []
    const paragraphs = text.split('\n')

    for (const para of paragraphs) {
      if (para === '') { lines.push(''); continue }

      let line = ''
      for (const ch of para) {
        const test = line + ch
        if (ctx.measureText(test).width > maxWidth && line !== '') {
          const lastSpace = line.lastIndexOf(' ')
          if (lastSpace > 0 && /[A-Za-z0-9]/.test(ch)) {
            lines.push(line.slice(0, lastSpace))
            line = line.slice(lastSpace + 1) + ch
          } else {
            lines.push(line)
            line = ch
          }
        } else {
          line = test
        }
      }
      if (line !== '') lines.push(line)
    }

    return lines.length > 0 ? lines : ['']
  }

  private clipToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text
    const ellipsis = '…'
    let result = text
    while (result.length > 1 && ctx.measureText(result + ellipsis).width > maxWidth) {
      result = result.slice(0, -1)
    }
    return result + ellipsis
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + width, y, x + width, y + height, r)
    ctx.arcTo(x + width, y + height, x, y + height, r)
    ctx.arcTo(x, y + height, x, y, r)
    ctx.arcTo(x, y, x + width, y, r)
    ctx.closePath()
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob !== null) resolve(blob)
          else reject(new Error('canvas.toBlob returned null'))
        }, 'image/png')
      } catch (error) {
        reject(error as Error)
      }
    })
  }
}
