/**
 * 对话导出：PDF 导出器（移植原 conversationExport/pdf-exporter.js）。
 * 文字排版方案：把对话渲染成结构化 HTML 塞进隐藏 iframe，调用浏览器打印
 * （用户在弹出对话框里选择「另存为 PDF」）。文字可选中/可搜索、自动分页；
 * 公式在页面存在 MathJax 时渲染为 SVG，否则回退 <code>LaTeX</code>。
 * markdown 块解析复用 CEPngExporter.parseMarkdownBlocks（与 PNG 一致）。
 */
import { ceFormatChatTime, ceFormatLocalTime, ceGetTheme, type CeTexts, type ExportImage, type ExportJob, type ExportTurn } from './constants.ts'
import type { CEPngExporter } from './pngExporter.ts'

interface MathJaxLike {
  startup?: { promise?: Promise<unknown> }
  tex2svg?: (latex: string, options: { display: boolean }) => Element
}

function getMathJax(): MathJaxLike | null {
  const mj = (window as { MathJax?: MathJaxLike }).MathJax
  return typeof mj === 'object' ? mj : null
}

export class CEPdfExporter {
  private parser: CEPngExporter | null = null
  private mjReady = false
  private texts!: CeTexts

  /**
   * 导出 PDF（原 export）。
   * @param job - 导出任务。
   * @param themeId - 主题色 id。
   * @param texts - 文案面。
   * @param markdownParser - 复用其 parseMarkdownBlocks。
   */
  async export(job: ExportJob, themeId: string, texts: CeTexts, markdownParser?: CEPngExporter): Promise<void> {
    this.texts = texts
    this.parser = markdownParser ?? null
    this.mjReady = this.containsFormula(job) ? await this.ensureMathJax() : false
    const html = this.buildHtml(job, themeId)
    await this.printHtml(html)
  }

  // ==================== HTML 构建 ====================

  private buildHtml(job: ExportJob, themeId: string): string {
    const { meta, options, turns } = job
    const theme = ceGetTheme(themeId)
    const accent = theme.gradient !== undefined ? theme.gradient[0][1] : theme.solid ?? '#6128ff'

    const title = meta.title !== '' ? meta.title : this.texts.defaultTitle

    const metaLines: string[] = []
    if (options.showUrl && meta.url !== '') {
      metaLines.push(`${this.texts.sourceLabel}: ${this.escapeHtml(meta.url)}`)
    }
    if (options.showTime) {
      metaLines.push(`${this.texts.timeLabel}: ${this.escapeHtml(ceFormatLocalTime(meta.exportTime))}`)
    }

    const turnsHtml = turns.map(turn => this.turnHtml(turn, options)).join('')

    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${this.escapeHtml(title)}</title>
<style>${this.css(accent)}</style>
</head>
<body>
<div class="ce-header">
  <div class="ce-title">${this.escapeHtml(title)}</div>
  ${metaLines.length > 0 ? `<div class="ce-meta">${metaLines.join('<br>')}</div>` : ''}
</div>
${turnsHtml}
</body>
</html>`
  }

  private css(accent: string): string {
    return `
@page { margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif; color: #1f2937; font-size: 14px; line-height: 1.7; margin: 0; }
.ce-header { border-bottom: 3px solid ${accent}; padding-bottom: 12px; margin-bottom: 22px; }
.ce-title { font-size: 22px; font-weight: 700; }
.ce-meta { color: #6b7280; font-size: 12px; margin-top: 8px; word-break: break-all; }
.ce-turn { margin: 16px 0; }
.ce-row { display: flex; gap: 10px; align-items: flex-start; margin: 8px 0; }
.ce-badge { flex: none; width: 24px; height: 24px; margin-top: 6px; border-radius: 50%; font-weight: 700; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
.ce-badge.q { background: ${accent}; color: #fff; }
.ce-badge.a { background: #e5e7eb; color: #4b5563; }
.ce-body { flex: 1; min-width: 0; }
.ce-user { background: #f3f4f6; border-radius: 10px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
.ce-time { color: #6b7280; font-size: 12px; margin-bottom: 4px; }
.ce-content { word-break: break-word; }
.ce-content p { margin: 8px 0; }
.ce-content h1, .ce-content h2, .ce-content h3, .ce-content h4 { margin: 12px 0 6px; line-height: 1.4; }
.ce-content ul, .ce-content ol { margin: 8px 0; padding-left: 22px; }
.ce-content li { margin: 3px 0; }
.ce-content pre { background: #f6f8fa; padding: 12px; border-radius: 8px; overflow-x: auto; break-inside: avoid; }
.ce-content code { font-family: "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 13px; }
.ce-content pre code { white-space: pre-wrap; word-break: break-word; }
.ce-content blockquote { border-left: 3px solid #d1d5db; margin: 8px 0; padding-left: 12px; color: #6b7280; }
.ce-content hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
.ce-formula { text-align: center; margin: 12px 0; overflow-x: auto; break-inside: avoid; }
.ce-img { max-width: 100%; height: auto; border-radius: 6px; margin: 8px 0; break-inside: avoid; }
.ce-img-missing { color: #9ca3af; font-size: 13px; background: #f3f4f6; border-radius: 8px; padding: 10px 12px; }
.ce-empty { color: #9ca3af; }
svg { vertical-align: middle; }
a { color: #2563eb; text-decoration: none; }
`
  }

  private turnHtml(turn: ExportTurn, options: ExportJob['options']): string {
    const askTime = options.showConversationTime ? ceFormatChatTime(turn.user.time) : ''
    const userText = turn.user.text !== '' ? turn.user.text : this.texts.emptyUserPreview
    const userImages = turn.user.images.map(img => this.imageHtml(img)).join('')
    const assistantBody = this.assistantHtml(turn)

    return `
<div class="ce-turn">
  <div class="ce-row">
    <span class="ce-badge q">${this.escapeHtml(this.texts.exportRoleUser)}</span>
    <div class="ce-body">
      <div class="ce-user">${askTime !== '' ? `<div class="ce-time">${this.escapeHtml(askTime)}</div>` : ''}${this.escapeHtml(userText)}</div>
      ${userImages}
    </div>
  </div>
  <div class="ce-row">
    <span class="ce-badge a">${this.escapeHtml(this.texts.exportRoleAssistant)}</span>
    <div class="ce-body"><div class="ce-content">${assistantBody}</div></div>
  </div>
</div>`
  }

  private assistantHtml(turn: ExportTurn): string {
    const images = turn.assistant.images.map(img => this.imageHtml(img)).join('')
    const md = turn.assistant.markdown
    let body = ''
    if (md !== '') {
      body = this.blocksToHtml(md)
    } else if (turn.assistant.text !== '') {
      body = `<p>${this.escapeHtml(turn.assistant.text)}</p>`
    }
    if (body === '' && images === '') {
      return `<p class="ce-empty">${this.escapeHtml(this.texts.emptyAssistant)}</p>`
    }
    return body + images
  }

  // ==================== markdown → HTML ====================

  private blocksToHtml(md: string): string {
    // 复用 PNG 的块解析；不可用时退化为按段落切分
    const blocks = this.parser !== null
      ? this.parser.parseMarkdownBlocks(md)
      : md.split(/\n{2,}/).map(t => ({ kind: 'paragraph' as const, text: t.trim() })).filter(b => b.text !== '')

    let html = ''
    let i = 0
    while (i < blocks.length) {
      const b = blocks[i]

      if (b.kind === 'listitem') {
        const tag = b.ordered ? 'ol' : 'ul'
        let items = ''
        while (i < blocks.length) {
          const cur = blocks[i]
          if (cur.kind !== 'listitem') break
          items += `<li>${this.inlineToHtml(cur.text)}</li>`
          i++
        }
        html += `<${tag}>${items}</${tag}>`
        continue
      }

      switch (b.kind) {
        case 'heading': {
          const level = Math.min(Math.max(b.level, 1), 6)
          html += `<h${String(level)}>${this.inlineToHtml(b.text)}</h${String(level)}>`
          break
        }
        case 'code':
          html += `<pre><code>${this.escapeHtml(b.code)}</code></pre>`
          break
        case 'quote':
          html += `<blockquote>${this.inlineToHtml(b.text)}</blockquote>`
          break
        case 'formula': {
          const svg = this.latexToSvg(b.latex, true)
          html += `<div class="ce-formula">${svg ?? `<code>${this.escapeHtml(b.latex)}</code>`}</div>`
          break
        }
        default:
          html += `<p>${this.inlineToHtml(b.text)}</p>`
      }
      i++
    }
    return html
  }

  /**
   * 行内 markdown → HTML（原 _inlineToHtml）：先挖出行内公式/代码占位，
   * 转义后再处理图片/链接/粗体/斜体，最后还原占位。
   */
  private inlineToHtml(text: string): string {
    const stash: string[] = []
    const put = (h: string): string => `\u0000${String(stash.push(h) - 1)}\u0000`

    let s = text

    // 行内公式 $...$
    s = s.replace(/\$([^$\n]+?)\$/g, (_, tex: string) => {
      const svg = this.latexToSvg(tex, false)
      return put(svg ?? `<code>${this.escapeHtml(tex)}</code>`)
    })
    // 行内代码 `...`
    s = s.replace(/`([^`]+?)`/g, (_, code: string) => put(`<code>${this.escapeHtml(code)}</code>`))

    // 转义正文
    s = this.escapeHtml(s)

    // 图片 ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt: string, url: string) =>
      `<img class="ce-img" src="${this.attr(url)}" alt="${this.attr(alt)}">`)
    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t: string, url: string) =>
      `<a href="${this.attr(url)}">${t}</a>`)
    // 粗体 **...**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 斜体 *...*
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')

    // eslint-disable-next-line no-control-regex
    return s.replace(/\u0000(\d+)\u0000/g, (_, idx: string) => stash[Number(idx)])
  }

  // ==================== 公式 ====================

  private containsFormula(job: ExportJob): boolean {
    return job.turns.some((turn) => {
      const markdown = turn.assistant.markdown
      if (markdown === '') return false
      return /\\\(|\\\[|\$\$/.test(markdown)
        || /(^|[^\\$])\$[^$\n]+\$(?!\$)/m.test(markdown)
    })
  }

  private async ensureMathJax(): Promise<boolean> {
    try {
      const mj = getMathJax()
      if (mj === null) return false
      if (mj.startup?.promise !== undefined) await mj.startup.promise
      return typeof mj.tex2svg === 'function'
    } catch {
      return false
    }
  }

  private latexToSvg(latex: string, display: boolean): string | null {
    if (!this.mjReady || latex === '') return null
    try {
      const mj = getMathJax()
      if (mj?.tex2svg === undefined) return null
      const node = mj.tex2svg(latex, { display })
      const svg = node.querySelector('svg')
      if (svg === null) return null
      svg.style.color = '#1f2937'
      return svg.outerHTML
    } catch {
      return null
    }
  }

  // ==================== 图片 / 工具 ====================

  private imageHtml(image: ExportImage): string {
    if (image.src !== '') {
      return `<img class="ce-img" src="${this.attr(image.src)}" alt="${this.attr(image.alt)}">`
    }
    return `<div class="ce-img-missing">［${this.escapeHtml(this.texts.imageCannotEmbed)}］</div>`
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  private attr(s: string): string {
    return this.escapeHtml(s).replace(/"/g, '&quot;')
  }

  // ==================== 打印 ====================

  private printHtml(html: string): Promise<void> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;height:1123px;border:0;opacity:0;'
      document.body.appendChild(iframe)

      const win = iframe.contentWindow
      if (win === null) {
        iframe.remove()
        resolve()
        return
      }
      const doc = win.document
      doc.open()
      doc.write(html)
      doc.close()

      let printed = false
      const finish = (): void => {
        if (printed) return
        printed = true
        try {
          win.focus()
          win.print()
        } catch { /* ignore */ }
        // 打印对话框关闭后再移除 iframe
        setTimeout(() => {
          iframe.remove()
          resolve()
        }, 500)
      }

      const waitImagesThenPrint = (): void => {
        const imgs = Array.from(doc.images)
        const pending = imgs.filter(im => !im.complete)
        if (pending.length === 0) { finish(); return }
        let remaining = pending.length
        const onSettle = (): void => {
          remaining -= 1
          if (remaining <= 0) finish()
        }
        for (const im of pending) {
          im.addEventListener('load', onSettle, { once: true })
          im.addEventListener('error', onSettle, { once: true })
        }
        // 兜底：图片迟迟不返回也照常打印
        setTimeout(finish, 4000)
      }

      let started = false
      const start = (): void => {
        if (started) return
        started = true
        waitImagesThenPrint()
      }
      win.addEventListener('load', start)
      setTimeout(start, 800)
    })
  }
}
