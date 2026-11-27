interface Span { start: number; end: number }
interface CodeSpan extends Span { text: string }
interface FencedCodeSpan extends Span { contentStart: number; contentEnd: number; quoteDepth: number; info: string }
interface MarkdownImage extends Span { src: string; alt: string }

export function replaceMarkdownTokens<T extends Span>(
  source: string, tokens: readonly T[], render: (token: T) => string, renderText = (text: string) => text,
): string {
  let result = '', last = 0
  for (const token of tokens) {
    result += renderText(source.slice(last, token.start)) + render(token)
    last = token.end
  }
  return result + renderText(source.slice(last))
}

/** 反引号数量必须匹配，避免多反引号代码示例被拆成普通正文。 */
export function inlineCodeSpans(source: string): CodeSpan[] {
  const spans: CodeSpan[] = []
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\\') { index++; continue; }
    if (source[index] !== '`') continue
    const start = index
    while (source[index] === '`') index++
    const size = index - start
    let cursor = index
    while ((cursor = source.indexOf('`', cursor)) !== -1) {
      const closing = cursor
      while (source[cursor] === '`') cursor++
      if (cursor - closing !== size) continue
      spans.push({ start, end: cursor, text: source.slice(index, closing) })
      index = cursor - 1
      break
    }
    if (cursor === -1) index--
  }
  return spans
}

/** Keep code opaque across formatting that can span a literal, such as a link label. */
export function markdownLiterals() {
  const values: string[] = []
  const protect = (text: string): string => `\u0000${values.push(text) - 1}\u0000`
  return {
    protect,
    protectInline: (source: string): string => replaceMarkdownTokens(source, inlineCodeSpans(source),
      code => protect(code.text), prose => prose.replaceAll('\u0000', () => protect('\u0000'))),
    restore: (text: string): string => text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => values[Number(index)]),
  }
}

export function fencedCodeSpans(source: string): FencedCodeSpan[] {
  const spans: FencedCodeSpan[] = []
  let fence: { start: number; marker: string; contentStart: number; quoteDepth: number; info: string } | undefined
  let start = 0
  for (const line of source.split('\n')) {
    if (start === source.length) break
    const end = Math.min(start + line.length + 1, source.length)
    const quotes = line.match(/^(?: {0,3}>[ \t]?)+/)?.[0] ?? ''
    const quoteDepth = quotes.split('>').length - 1
    const match = line.slice(quotes.length).replace(/\r$/, '').match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    const lineBreak = source[start - 2] === '\r' ? 2 : 1
    if (fence !== undefined && quoteDepth < fence.quoteDepth) {
      // A block quote ending also closes its code block. This line belongs to the outer block.
      spans.push({ ...fence, end: start, contentEnd: Math.max(fence.contentStart, start - lineBreak) })
      fence = undefined
    }
    if (match !== null) {
      const [, marker, rest] = match
      if (fence === undefined) {
        // Backticks in a backtick fence's info string disqualify it (e.g. a line of inline code).
        if (marker[0] !== '`' || !rest.includes('`')) {
          fence = { start, marker, contentStart: end, quoteDepth, info: rest.trim() }
        }
      } else if (quoteDepth === fence.quoteDepth && marker[0] === fence.marker[0]
        && marker.length >= fence.marker.length && rest.trim() === '') {
        spans.push({ ...fence, end, contentEnd: Math.max(fence.contentStart, start - lineBreak) })
        fence = undefined
      }
    }
    start = end
  }
  if (fence !== undefined) spans.push({ ...fence, end: source.length, contentEnd: source.length })
  return spans
}

export function fencedCodeText(source: string, fence: FencedCodeSpan): string {
  const body = source.slice(fence.contentStart, fence.contentEnd)
  if (fence.quoteDepth === 0) return body
  const quotePrefix = new RegExp(`^(?: {0,3}>[ \\t]?){1,${fence.quoteDepth}}`, 'gm')
  return body.replace(quotePrefix, '')
}

function maskMarkdownCode(markdown: string): string {
  const mask = (text: string): string => text.replace(/[^\n]/g, ' ')
  const source = replaceMarkdownTokens(markdown, fencedCodeSpans(markdown), span => mask(markdown.slice(span.start, span.end)))
    .split('\n').map(line => {
      const content = line.replace(/^(?: {0,3}>[ \t]?)+/, '')
      return /^(?: {4}|\t)/.test(content) ? mask(line) : line
    }).join('\n')
  return replaceMarkdownTokens(source, inlineCodeSpans(source), span => mask(source.slice(span.start, span.end)))
}

/** 读取图片引用的范围，使用括号计数保留 URL；与 PDF 使用同一个解析结果。 */
export function markdownImages(markdown: string): MarkdownImage[] {
  const source = maskMarkdownCode(markdown)
  const unescape = (text: string) => text.replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, '$1')
  const images: MarkdownImage[] = []
  for (let start = 0; start < source.length; start++) {
    if (source[start] === '\\') { start++; continue; }
    if (!source.startsWith('![', start)) continue
    let cursor = start + 2, brackets = 1
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === '\\') { cursor++; continue; }
      if (source[cursor] === '[') brackets++
      if (source[cursor] === ']' && --brackets === 0) break
    }
    const labelEnd = cursor
    if (brackets || source[++cursor] !== '(') continue
    cursor++
    while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++
    let urlStart = cursor, urlEnd
    if (source[cursor] === '<') {
      urlStart = ++cursor
      while (cursor < source.length && source[cursor] !== '>') cursor++
      if (cursor === source.length) continue
      urlEnd = cursor++
    } else {
      let depth = 0
      for (; cursor < source.length; cursor++) {
        const char = source[cursor]
        if (char === '\\') { cursor++; continue; }
        if (char === '(') depth++
        else if (char === ')') { if (!depth) break; depth--; }
        else if (/\s/.test(char)) break
      }
      if (depth) continue
      urlEnd = cursor
    }
    while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++
    if (source[cursor] === '"' || source[cursor] === "'") {
      const quote = source[cursor++]
      while (cursor < source.length && source[cursor] !== quote) {
        if (source[cursor] === '\\') cursor++
        cursor++
      }
      if (source[cursor++] !== quote) continue
      while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++
    }
    if (source[cursor] !== ')' || urlStart === urlEnd) continue
    images.push({ start, end: cursor + 1, src: unescape(markdown.slice(urlStart, urlEnd)),
      alt: unescape(markdown.slice(start + 2, labelEnd)) })
    start = cursor
  }
  return images
}

export function splitTableRow(line: string): string[] {
  const cells = line.trim().split(/(?<!\\)\|/)
  if (cells[0] === '') cells.shift()
  if (cells.at(-1) === '') cells.pop()
  return cells.map(cell => cell.trim().replace(/\\\|/g, '|'))
}

export function safeImageSource(src: string): string {
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);/i.test(src)) return src
  try {
    const url = new URL(src, document.baseURI)
    return ['https:', 'http:', 'blob:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}
