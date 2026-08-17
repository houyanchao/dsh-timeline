/**
 * 选区复制增强（移植原 quickAsk/selection-copy.js）。
 *
 * 当选区包含「公式」时，追问工具栏提供「复制」按钮。复制后剪贴板包含两份内容：
 *   - text/html  — 公式转 LaTeX 文本节点 / MathML 节点
 *   - text/plain — 公式按 formulaFormat 模板（如 $%s$）输出，其余按 textContent
 *
 * 公式优先级（按用户设置，与原版一致）：
 *   - 同时启用：LaTeX → MathML 兜底
 *   - 仅 LaTeX：仅 LaTeX，无源时跳过
 *   - 仅 MathML：仅 MathML
 *   - 全部关闭：公式不再作为触发器
 *
 * 与原版的差异：
 * - 原版另有「选区含高亮标记」触发器与高亮样式清洗（_rangeHasHighlight /
 *   _sanitizeHighlightMark），highlight 模块已确定不迁移，相关代码剔除；
 * - 配置从 chrome.storage 异步加载 + onChanged 监听，改为 settingsStore
 *   同步读取（每次调用取最新值，无需缓存与监听）。
 */
import { settingsStore } from '../shared/settings.ts'
import { FORMULA_FORMATS } from '../formula/formats.ts'
import { parseLatex, parseMathML } from '../formula/parser.ts'

/** 公式元素选择器（DSH 使用 KaTeX 渲染）。 */
const FORMULA_SELECTOR = '.katex-display,.katex'

/**
 * 临时标记属性：在原 DOM 上短暂打标，cloneContents 后通过该属性回查。
 * 使用前缀防止与页面冲突，try/finally 保证一定移除。
 */
const COPY_MARKER_ATTR = 'data-ait-copy-marker'

/** 当前生效的公式复制配置（原 _config，改为即取即用）。 */
interface CopyConfig {
  readonly latexOn: boolean
  readonly mathmlOn: boolean
  readonly template: string
}

function getConfig(): CopyConfig {
  const settings = settingsStore.get()
  const fmt = FORMULA_FORMATS.find(f => f.id === settings.formulaFormat)
  return {
    latexOn: settings.formulaLatexEnabled,
    mathmlOn: settings.formulaMathMLEnabled,
    template: fmt !== undefined ? fmt.template : '%s',
  }
}

// ==================== 选区检测 ====================

/**
 * 选区是否包含「公式」（且公式提取至少有一种被启用）。
 * 同步、低成本：只在追问按钮显示时调用一次（原 hasRichContent）。
 * @param range - 已保存的选区 Range。
 * @returns 是否需要显示复制按钮。
 */
export function hasRichContent(range: Range | null): boolean {
  if (range === null || range.collapsed) return false

  const root = getRangeRoot(range)
  if (root === null) return false

  const config = getConfig()
  const formulasEnabled = config.latexOn || config.mathmlOn
  return formulasEnabled && rangeHasFormula(range, root)
}

function getRangeRoot(range: Range): Element | null {
  const ac = range.commonAncestorContainer
  return ac.nodeType === Node.TEXT_NODE ? ac.parentElement : (ac instanceof Element ? ac : null)
}

function rangeHasFormula(range: Range, root: Element): boolean {
  const candidates = root.querySelectorAll(FORMULA_SELECTOR)
  for (const el of candidates) {
    if (range.intersectsNode(el)) return true
  }
  return false
}

// ==================== 公式定位 ====================

/**
 * 找出选区内所有「最外层」公式元素（原 _findOutermostFormulas）。
 * 公式结构往往嵌套（.katex 内含 .katex-mathml/.katex-html），
 * 只取最外层那一个，避免重复处理。
 */
function findOutermostFormulas(range: Range, root: Element): Element[] {
  const all = Array.from(root.querySelectorAll(FORMULA_SELECTOR))
  return all.filter((el) => {
    if (!range.intersectsNode(el)) return false
    if (el.parentElement?.closest(FORMULA_SELECTOR) != null) return false
    return true
  })
}

// ==================== Payload 构建 ====================

/**
 * 构建剪贴板 payload（原 buildPayload）。
 * @param range - 选区 Range。
 * @returns html 与 plain 两份内容。
 */
export function buildPayload(range: Range | null): { html: string; plain: string } {
  if (range === null || range.collapsed) {
    return { html: '', plain: '' }
  }

  const root = getRangeRoot(range)
  if (root === null) return { html: '', plain: '' }

  const formulas = findOutermostFormulas(range, root)

  // 在原 DOM 短暂打标，cloneContents 后两次扫描回查
  formulas.forEach((el, i) => { el.setAttribute(COPY_MARKER_ATTR, String(i)) })

  try {
    const html = buildHtml(range, formulas)
    const plain = buildPlain(range, formulas)
    return { html, plain }
  } finally {
    formulas.forEach((el) => { el.removeAttribute(COPY_MARKER_ATTR) })
  }
}

function buildHtml(range: Range, formulas: readonly Element[]): string {
  const fragment = range.cloneContents()

  // 替换公式
  fragment.querySelectorAll(`[${COPY_MARKER_ATTR}]`).forEach((cloneEl) => {
    const idx = parseInt(cloneEl.getAttribute(COPY_MARKER_ATTR) ?? '', 10)
    const original = formulas[idx]
    if (original === undefined) {
      cloneEl.removeAttribute(COPY_MARKER_ATTR)
      return
    }
    const replacement = formulaToHtml(original)
    if (replacement !== null) {
      cloneEl.replaceWith(replacement)
    } else {
      // 无源可提取：保留原 DOM 视觉，仅清理标记
      cloneEl.removeAttribute(COPY_MARKER_ATTR)
    }
  })

  const container = document.createElement('div')
  container.appendChild(fragment)
  return container.innerHTML
}

function buildPlain(range: Range, formulas: readonly Element[]): string {
  const fragment = range.cloneContents()

  fragment.querySelectorAll(`[${COPY_MARKER_ATTR}]`).forEach((cloneEl) => {
    const idx = parseInt(cloneEl.getAttribute(COPY_MARKER_ATTR) ?? '', 10)
    const original = formulas[idx]
    if (original === undefined) return
    const text = formulaToPlain(original)
    if (text !== null) {
      cloneEl.replaceWith(document.createTextNode(text))
    }
    // 无源时保留原始克隆（textContent 会拿到公式的渲染后文本，至少不丢内容）
  })

  // 浏览器 Cmd+C 默认会用换行表达块级元素，这里使用一个轻量 walker 做近似
  return fragmentToPlainText(fragment)
}

// ==================== 公式转换 ====================

function formulaToHtml(originalEl: Element): Element | null {
  const { latexOn, mathmlOn, template } = getConfig()

  if (latexOn) {
    const latex = safeParseLatex(originalEl)
    if (latex !== null) {
      const span = document.createElement('span')
      span.setAttribute('data-ait-formula', 'latex')
      span.textContent = template.replace('%s', latex)
      return span
    }
  }

  if (mathmlOn) {
    const mathml = safeParseMathML(originalEl)
    if (mathml !== null) {
      const wrapper = document.createElement('span')
      wrapper.setAttribute('data-ait-formula', 'mathml')
      // 安全注入：用 template 元素解析 XML/HTML 字符串
      const tmpl = document.createElement('template')
      tmpl.innerHTML = mathml
      wrapper.appendChild(tmpl.content.cloneNode(true))
      return wrapper
    }
  }

  return null
}

function formulaToPlain(originalEl: Element): string | null {
  const { latexOn, mathmlOn, template } = getConfig()

  if (latexOn) {
    const latex = safeParseLatex(originalEl)
    if (latex !== null) return template.replace('%s', latex)
  }

  if (mathmlOn) {
    const mathml = safeParseMathML(originalEl)
    if (mathml !== null) return mathml
  }

  return null
}

function safeParseLatex(el: Element): string | null {
  try {
    const raw = parseLatex(el)
    return raw !== null && raw.trim() !== '' ? raw.trim() : null
  } catch {
    return null
  }
}

function safeParseMathML(el: Element): string | null {
  try {
    const raw = parseMathML(el)
    return raw !== null && raw.trim() !== '' ? raw.trim() : null
  } catch {
    return null
  }
}

// ==================== 纯文本输出 ====================

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'BLOCKQUOTE', 'PRE', 'LI', 'TR',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'FIGURE', 'FIGCAPTION', 'HR', 'DL', 'DT', 'DD',
])

/**
 * 将 fragment 转为纯文本，对块级元素插入 \n，对 <br> 插入 \n
 * 保留与浏览器 Cmd+C 行为接近的换行语义（原 _fragmentToPlainText）。
 */
function fragmentToPlainText(fragment: DocumentFragment): string {
  const out: string[] = []
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const tag = (node as Element).tagName
    if (tag === 'BR') { out.push('\n'); return }
    if (tag === 'SCRIPT' || tag === 'STYLE') return

    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock && out.length > 0 && !out[out.length - 1].endsWith('\n')) {
      out.push('\n')
    }

    for (const child of node.childNodes) walk(child)

    if (isBlock && out.length > 0 && !out[out.length - 1].endsWith('\n')) {
      out.push('\n')
    }
  }

  for (const child of fragment.childNodes) walk(child)
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}

// ==================== 剪贴板写入 ====================

/**
 * 复制选区（必须在用户手势的同步路径上调用以确保 user gesture）。
 * @param range - 选区 Range。
 * @returns 是否复制成功。
 */
export async function copyRange(range: Range | null): Promise<boolean> {
  const { html, plain } = buildPayload(range)
  if (html === '' && plain === '') return false

  try {
    if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
      const wrapped = `<html><body>${html}</body></html>`
      const item = new ClipboardItem({
        'text/html': new Blob([wrapped], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
    } else {
      await navigator.clipboard.writeText(plain)
    }
    return true
  } catch {
    // 退路：用 execCommand 模拟一次（部分老环境）
    return fallbackCopy(plain)
  }
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
