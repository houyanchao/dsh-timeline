/**
 * 公式源码解析器：移植原扩展 FormulaSourceParser（latex-extractor.js）。
 * - parseLatex：按优先级从 data-math / KaTeX annotation / data-latex 提取 LaTeX；
 * - isValidLatex：temml 试渲染判定合法性（LRU 缓存 500 条）；
 * - parseMathML：已提取的 LaTeX（data-latex-source）经 temml 转 MathML；
 * - prefixForWord：为 Word 兼容加 mml: 命名空间前缀。
 * 原 libs/temml.min.js 改为 npm 依赖打包内联。
 */
import temml from 'temml'

/** isValidLatex 结果缓存（原 _validLatexCache）。 */
const validLatexCache = new Map<string, boolean>()

const VALID_LATEX_CACHE_MAX = 500

/**
 * 从公式元素中解析 LaTeX 源码，按优先级尝试多种方式。
 * @param formulaElement - 公式 DOM 元素。
 * @returns LaTeX 源码，失败返回 null。
 */
export function parseLatex(formulaElement: Element | null): string | null {
  if (formulaElement === null) {
    return null
  }

  // 方法1: 当前元素的 data-math 属性
  const dataMath = formulaElement.getAttribute('data-math')
  if (dataMath !== null) {
    return dataMath.trim()
  }

  // 方法2: 从 annotation 标签获取（KaTeX，DeepSeek 使用）
  const annotation = formulaElement.querySelector('annotation[encoding="application/x-tex"]')
  if (annotation !== null) {
    return (annotation.textContent ?? '').trim()
  }

  // 方法3: 从 .katex-mathml 中的 annotation 获取
  const mathml = formulaElement.querySelector('.katex-mathml annotation')
  if (mathml !== null) {
    return (mathml.textContent ?? '').trim()
  }

  // 方法4: 通用 data-latex 属性
  const dataLatex = formulaElement.getAttribute('data-latex')
  if (dataLatex !== null) {
    return dataLatex.trim()
  }

  return null
}

/**
 * 判断字符串是否为合法 LaTeX 数学公式。
 * @param text - 待检测文本（可含 $...$ 等分隔符）。
 * @returns 是否合法。
 */
export function isValidLatex(text: string): boolean {
  if (text === '' || typeof text !== 'string') return false

  const trimmed = text.trim()
  const cached = validLatexCache.get(trimmed)
  if (cached !== undefined) return cached

  const result = checkValidLatex(trimmed)
  validLatexCache.set(trimmed, result)
  if (validLatexCache.size > VALID_LATEX_CACHE_MAX) {
    const oldest = validLatexCache.keys().next().value
    if (oldest !== undefined) validLatexCache.delete(oldest)
  }
  return result
}

/** 试渲染判定（原 _checkValidLatex）。 */
function checkValidLatex(trimmed: string): boolean {
  const latex = stripMathDelimiters(trimmed)
  if (latex === '') return false

  // 轻量启发式，过滤普通图片描述
  if (!/\\[a-zA-Z]+|[\^_=+\-*/()]/.test(latex)) return false

  const displayMode = /^\$\$|^\\\[|\\begin\{/.test(trimmed)

  try {
    temml.renderToString(latex, {
      displayMode,
      throwOnError: true,
      trust: false,
    })
    return true
  } catch {
    return false
  }
}

/**
 * 从公式元素中解析 MathML（通过已提取的 LaTeX 即 data-latex-source 经 temml 转换）。
 * @param formulaElement - 公式 DOM 元素。
 * @returns MathML XML 字符串，失败返回 null。
 */
export function parseMathML(formulaElement: Element | null): string | null {
  if (formulaElement === null) return null

  const latexSource = formulaElement.getAttribute('data-latex-source')
  if (latexSource !== null && latexSource !== '') {
    const generated = latexToMathML(latexSource)
    if (generated !== null) return generated
  }

  return null
}

/** 剥离 LaTeX 数学分隔符：\(...\)  \[...\]  $$...$$  $...$（原 _stripMathDelimiters）。 */
export function stripMathDelimiters(text: string): string {
  if (text === '') return text
  if (text.startsWith('\\(') && text.endsWith('\\)')) {
    return text.slice(2, -2).trim()
  }
  if (text.startsWith('\\[') && text.endsWith('\\]')) {
    return text.slice(2, -2).trim()
  }
  if (text.startsWith('$$') && text.endsWith('$$') && text.length > 4) {
    return text.slice(2, -2).trim()
  }
  if (text.startsWith('$') && text.endsWith('$') && text.length > 2) {
    return text.slice(1, -1).trim()
  }
  return text
}

/**
 * 通过 temml 引擎将 LaTeX 公式转为 MathML 标记。
 * @param latex - LaTeX 源码。
 * @returns MathML 字符串，转换失败返回 null。
 */
export function latexToMathML(latex: string): string | null {
  if (latex === '') return null

  try {
    const output = temml.renderToString(latex, {
      displayMode: false,
      xml: true,
      annotate: false,
      throwOnError: false,
      trust: false,
    })
    return stripMathMLWrapper(output)
  } catch {
    return null
  }
}

/** 移除 MathML 中的 annotation/semantics 包装（原 TODO：后续重新实现，暂原样返回）。 */
export function stripMathMLWrapper(mathml: string): string {
  return mathml
}

/**
 * 转换为 Word 兼容的 MathML：Word 要求所有 MathML 标签带 mml: 命名空间前缀。
 * @param mathml - 标准 MathML 字符串。
 * @returns Word 兼容的 MathML 字符串。
 */
export function prefixForWord(mathml: string): string {
  if (mathml === '') return mathml

  const NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
  const parser = new DOMParser()
  const doc = parser.parseFromString(mathml, 'application/xml')

  if (doc.querySelector('parsererror') !== null) {
    return mathml
  }

  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? ''
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ''
    }
    const element = node as Element

    const isMathML = element.namespaceURI === NAMESPACE
    const tagName = isMathML ? `mml:${element.localName}` : element.localName

    let attrs = ''
    for (const attr of element.attributes) {
      if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue
      attrs += ` ${attr.name}="${attr.value}"`
    }

    if (element.localName === 'math' && isMathML) {
      attrs += ` xmlns:mml="${NAMESPACE}"`
    }

    const children = Array.from(element.childNodes).map(serialize).join('')
    return `<${tagName}${attrs}>${children}</${tagName}>`
  }

  return serialize(doc.documentElement)
}
