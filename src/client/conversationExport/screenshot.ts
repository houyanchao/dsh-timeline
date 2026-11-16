import { getFontEmbedCSS, toBlob } from './vendor/html-to-image.cjs'

const OMIT = 'input, textarea, select, script, style, link, iframe, object, embed, video, [hidden], [role="toolbar"], [data-turn-tail], [data-dsh-timeline-ui]'
const MAX_EDGE = 16000
const MAX_AREA = 32_000_000
const MAX_FILES = 30
const IMAGE_TIMEOUT = 8000
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const RETRYABLE_IMAGE_STATUS = new Set([408, 500, 502, 503, 504])
const CSS_IMAGE_URL = /url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^)\\])*))\s*\)/gi
const EMPTY_BACKGROUND = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E'

type StyledElement = HTMLElement | SVGElement | MathMLElement

function cloneContent(node: Node, properties: readonly string[], inherited?: CSSStyleDeclaration): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode()
  if (!(node instanceof HTMLElement || node instanceof SVGElement || node instanceof MathMLElement) || node.matches(OMIT)) return null
  // Keep the image candidate visible in the original message.
  if (node.tagName === 'SOURCE' && node.parentElement?.tagName === 'PICTURE') return null
  const style = getComputedStyle(node)
  if (style.display === 'none' || style.visibility !== 'visible') return null

  // Attachment previews are sometimes wrapped in buttons. Keep their contents with an inert wrapper.
  const clone = node instanceof HTMLButtonElement ? document.createElement('div') : node.cloneNode(false) as StyledElement
  for (const attribute of [...clone.attributes]) {
    if (attribute.name.startsWith('on') || attribute.name.startsWith('data-chat-')) clone.removeAttribute(attribute.name)
  }
  for (const name of style) {
    if (!name.startsWith('--')) continue
    const value = style.getPropertyValue(name)
    if (value !== inherited?.getPropertyValue(name)) clone.style.setProperty(name, value)
  }
  for (const name of properties) clone.style.setProperty(name, style.getPropertyValue(name))
  clone.style.setProperty('animation', 'none')
  clone.style.setProperty('transition', 'none')
  clone.style.setProperty('content-visibility', 'visible')
  if (style.position === 'fixed' || style.position === 'sticky') clone.style.setProperty('position', 'static')

  if (node instanceof HTMLImageElement && clone instanceof HTMLImageElement) {
    clone.removeAttribute('srcset')
    clone.removeAttribute('sizes')
    const src = node.currentSrc || node.getAttribute('src')?.trim()
    if (src) clone.src = src
    else clone.removeAttribute('src')
    clone.loading = 'eager'
  }
  if (node instanceof HTMLCanvasElement && clone instanceof HTMLCanvasElement) {
    clone.getContext('2d')?.drawImage(node, 0, 0)
  }
  for (const child of node.childNodes) {
    const copy = cloneContent(child, properties, style)
    if (copy !== null) clone.append(copy)
  }
  return clone
}

function waitForCapture<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    void Promise.resolve().then(() => {
      signal.throwIfAborted()
      return start()
    }).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

async function readImage(url: URL, cancel: AbortSignal): Promise<string> {
  if (!['data:', 'http:', 'https:', 'blob:'].includes(url.protocol)) throw new Error('image-unavailable')
  const request = new AbortController()
  const signal = AbortSignal.any([cancel, request.signal, AbortSignal.timeout(IMAGE_TIMEOUT)])
  let reader: FileReader | undefined
  let probe: HTMLImageElement | undefined

  async function fetchDataUrl(): Promise<string> {
    const options: RequestInit = { signal, credentials: 'same-origin' }
    let response = await fetch(url, options)
    if (RETRYABLE_IMAGE_STATUS.has(response.status) && !response.headers.has('Retry-After')) {
      await response.body?.cancel()
      signal.throwIfAborted()
      response = await fetch(url, options)
    }
    if (!response.ok) throw new Error('image-unavailable')
    const blob = await response.blob()
    signal.throwIfAborted()
    if (!blob.size || !blob.type.startsWith('image/')) throw new Error('image-unavailable')
    return await new Promise<string>((resolve, reject) => {
      const fileReader = new FileReader()
      reader = fileReader
      fileReader.onload = () => { resolve(String(fileReader.result)) }
      fileReader.onerror = () => { reject(fileReader.error) }
      fileReader.onabort = () => { reject(signal.reason) }
      fileReader.readAsDataURL(blob)
    })
  }

  try {
    return await waitForCapture(async () => {
      const data = url.protocol === 'data:' ? url.href : await fetchDataUrl()
      signal.throwIfAborted()
      probe = new Image()
      probe.src = data
      await probe.decode()
      return data
    }, signal)
  } finally {
    request.abort()
    if (reader?.readyState === FileReader.LOADING) reader.abort()
    probe?.removeAttribute('src')
  }
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|(?:\r\n|[\n\f\r])|([^\n\f\r]))/gi,
    (_, hex: string | undefined, character: string | undefined) => {
      if (!hex) return character ?? ''
      const codePoint = Number.parseInt(hex, 16)
      if (!codePoint || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\uFFFD'
      return String.fromCodePoint(codePoint)
    })
}

function imagePlaceholder(image: Element, label: string): string {
  const rect = image.getBoundingClientRect()
  const width = rect.width || 128
  const height = rect.height || 96
  const scale = Math.min(1, 256 / Math.max(width, height))
  const w = Math.max(2, Math.round(width * scale))
  const h = Math.max(2, Math.round(height * scale))
  const fontSize = Math.min(14, Math.floor((w - 12) / [...label].length))
  const mark = fontSize >= 9 && h >= 24
    ? `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" fill="#334155">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`
    : `<path d="M${w / 3} ${h / 3}l${w / 3} ${h / 3}m0 ${-h / 3}l${-w / 3} ${h / 3}" stroke="#64748b"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" fill="#e2e8f0" stroke="#94a3b8" stroke-dasharray="3 2"/>${mark}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

async function inlineImages(root: HTMLElement, signal: AbortSignal, unavailableLabel: string):
  Promise<{ unavailableImageCount: number; usableImageCount: number }> {
  const cache = new Map<string, Promise<string>>()
  let unavailableImageCount = 0
  let usableImageCount = 0
  async function readAsset(source: string): Promise<string | null> {
    signal.throwIfAborted()
    try {
      const url = new URL(source, document.baseURI)
      let asset = cache.get(url.href)
      if (asset === undefined) {
        asset = readImage(url, signal)
        cache.set(url.href, asset)
      }
      const data = await asset
      signal.throwIfAborted()
      usableImageCount++
      return data
    } catch {
      signal.throwIfAborted()
      unavailableImageCount++
      return null
    }
  }

  const jobs: Promise<void>[] = []
  for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
    const source = image.getAttribute('src')?.trim()
    if (!source) continue
    jobs.push(readAsset(source).then(data => {
      signal.throwIfAborted()
      image.src = data ?? imagePlaceholder(image, unavailableLabel)
    }))
  }
  for (const image of root.querySelectorAll('svg image')) {
    const source = (image.getAttribute('href') || image.getAttributeNS(XLINK_NAMESPACE, 'href'))?.trim()
    if (source) jobs.push(readAsset(source).then(data => {
      signal.throwIfAborted()
      image.setAttribute('href', data ?? imagePlaceholder(image, unavailableLabel))
      image.removeAttributeNS(XLINK_NAMESPACE, 'href')
    }))
  }
  for (const node of root.querySelectorAll<StyledElement>('[style]')) {
    const background = node.style.backgroundImage
    const sources = [...background.matchAll(CSS_IMAGE_URL)].map(([, doubleQuoted, singleQuoted, unquoted]) =>
      decodeCssEscapes(doubleQuoted ?? singleQuoted ?? unquoted.trim()))
    if (sources.length === 0) continue
    jobs.push(Promise.all(sources.map(readAsset)).then(images => {
      signal.throwIfAborted()
      let index = 0
      // Preserve failed background layer slots so the size and position lists stay aligned.
      node.style.backgroundImage = background.replace(CSS_IMAGE_URL, () => {
        const url = (images[index++] ?? EMPTY_BACKGROUND).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
        return `url("${url}")`
      })
    }))
  }
  await Promise.all(jobs)
  signal.throwIfAborted()
  return { unavailableImageCount, usableImageCount }
}

function hasOtherContent(root: HTMLElement): boolean {
  const svgDefinitions = 'svg :is(defs, title, desc, clipPath, mask, marker, pattern, symbol)'
  if (root.querySelector(`canvas, hr, svg :is(path, line, polyline, polygon, rect, circle, ellipse, use):not(${svgDefinitions} *)`)) return true
  const textNodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
    if (node.textContent?.trim() && !node.parentElement?.closest(svgDefinitions)) return true
  }
  return false
}

function sliceContent(root: HTMLElement, top: number, start: number, end: number): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement
  function prune(original: Element, copy: Element): void {
    for (let index = 0; index < original.children.length; index++) {
      const child = original.children[index]
      const duplicate = copy.children[index]
      const rect = child.getBoundingClientRect()
      if (duplicate instanceof HTMLElement && rect.width > 0 && rect.height > 0
        && (rect.bottom <= top + start || rect.top >= top + end)) {
        duplicate.replaceChildren()
        duplicate.style.height = duplicate.style.minHeight = `${rect.height}px`
      } else if (child instanceof HTMLCanvasElement && duplicate instanceof HTMLCanvasElement) {
        duplicate.getContext('2d')?.drawImage(child, 0, 0)
      } else if (!(child instanceof SVGElement || child instanceof MathMLElement)) {
        prune(child, duplicate)
      }
    }
  }
  prune(root, clone)
  clone.style.top = `-${start}px`
  return clone
}

export async function captureMessages(
  elements: readonly HTMLElement[], pixelRatio: number, cancel: AbortSignal, singleImage: boolean, unavailableLabel: string,
): Promise<{ blobs: Blob[]; unavailableImageCount: number }> {
  const operation = new AbortController()
  const signal = AbortSignal.any([cancel, operation.signal, AbortSignal.timeout(45000)])
  signal.throwIfAborted()
  const widths = elements.map(element => Math.ceil(element.getBoundingClientRect().width))
  const width = Math.max(...widths) + 32
  if (!elements.length || ![1, 2, 3, 4].includes(pixelRatio)
    || elements.some((element, index) => !element.isConnected || widths[index] < 1)
    || width * pixelRatio > MAX_EDGE) throw new Error('unavailable')

  const mount = document.createElement('div')
  mount.setAttribute('aria-hidden', 'true')
  mount.inert = true
  mount.dataset.dshTimelineUi = ''
  mount.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none`
  const content = document.createElement('div')
  content.style.cssText = 'position:absolute;left:0;right:0;top:0;padding:16px;display:flex;flex-direction:column;gap:12px'
  const properties = [...getComputedStyle(elements[0])].filter(name => !name.startsWith('--'))
  elements.forEach((element, index) => {
    const clone = cloneContent(element, properties)
    if (!(clone instanceof HTMLElement)) throw new Error('unavailable')
    Object.assign(clone.style, {
      margin: '0', height: 'auto', minHeight: '0', maxHeight: 'none',
      width: `${widths[index]}px`, minWidth: '0', maxWidth: 'none', position: 'static', boxSizing: 'border-box',
    })
    content.append(clone)
  })
  mount.append(content)
  document.body.append(mount)

  try {
    const { unavailableImageCount, usableImageCount } =
      await waitForCapture(() => inlineImages(content, signal, unavailableLabel), signal)
    if (unavailableImageCount > 0 && usableImageCount === 0 && !hasOtherContent(content)) throw new Error('image-unavailable')
    await waitForCapture(() => document.fonts.ready, signal)
    const height = Math.ceil(content.getBoundingClientRect().height)
    const limit = Math.floor(Math.min(MAX_EDGE / pixelRatio, MAX_AREA / (width * pixelRatio ** 2)))
    if (singleImage && height > limit) throw new Error('copy-too-long')
    if (height > limit * MAX_FILES) throw new Error('capture-too-large')
    const fontEmbedCSS = await waitForCapture(() => getFontEmbedCSS(content, {
      preferredFontFormat: 'woff2', fetchRequestInit: { signal },
    }), signal)
    const top = content.getBoundingClientRect().top
    const boundaries = [...content.children, ...content.querySelectorAll('p, pre, li, tr, img')]
      .map(element => Math.ceil(element.getBoundingClientRect().bottom - top))
      .sort((a, b) => b - a)
    const images: Blob[] = []
    for (let start = 0; start < height;) {
      const target = Math.min(start + limit, height)
      const minimum = Math.max(start + limit / 2, height - limit * (MAX_FILES - images.length - 1))
      const end = target === height ? target
        : (boundaries.find(value => value <= target && value >= minimum) ?? target)
      const viewport = document.createElement('div')
      viewport.style.cssText = `position:relative;overflow:hidden;width:${width}px;height:${end - start}px`
      viewport.append(sliceContent(content, top, start, end))
      mount.append(viewport)
      try {
        const blob = await waitForCapture(() => toBlob(viewport, {
          width, height: end - start, pixelRatio, skipAutoScale: true,
          fontEmbedCSS, fetchRequestInit: { signal }, includeStyleProperties: properties,
        }), signal)
        if (blob === null || blob.size === 0) throw new Error('capture-failed')
        images.push(blob)
      } finally {
        viewport.remove()
      }
      start = end
    }
    return { blobs: images, unavailableImageCount }
  } finally {
    operation.abort()
    mount.remove()
  }
}
