import { getFontEmbedCSS, toBlob } from './vendor/html-to-image.cjs'

const OMIT = 'input, textarea, select, script, style, link, iframe, object, embed, video, [hidden], [role="toolbar"], [data-turn-tail], [data-dsh-timeline-ui]'
const MAX_EDGE = 16000
const MAX_AREA = 32_000_000
const MAX_FILES = 30

type StyledElement = HTMLElement | SVGElement | MathMLElement

function cloneContent(node: Node, properties: readonly string[], inherited?: CSSStyleDeclaration): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode()
  if (!(node instanceof HTMLElement || node instanceof SVGElement || node instanceof MathMLElement) || node.matches(OMIT)) return null
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
    const src = node.currentSrc || node.getAttribute('src')
    if (src) clone.src = src
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
    void Promise.resolve().then(start).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

async function inlineImages(root: HTMLElement, signal: AbortSignal): Promise<void> {
  const cache = new Map<string, Promise<string>>()
  const load = (src: string): Promise<string> => {
    const url = new URL(src, document.baseURI)
    if (url.protocol === 'data:') return Promise.resolve(src)
    const cached = cache.get(url.href)
    if (cached !== undefined) return cached
    const job = (async () => {
      if (!['http:', 'https:', 'blob:'].includes(url.protocol)) throw new Error('image-unavailable')
      const response = await fetch(url, { signal, credentials: 'same-origin' })
      if (!response.ok) throw new Error('image-unavailable')
      const blob = await response.blob()
      if (!blob.type.startsWith('image/')) throw new Error('image-unavailable')
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        const abort = (): void => { reader.abort() }
        reader.onload = () => { resolve(String(reader.result)) }
        reader.onerror = () => { reject(reader.error) }
        reader.onabort = () => { reject(signal.reason) }
        reader.onloadend = () => { signal.removeEventListener('abort', abort) }
        signal.throwIfAborted()
        signal.addEventListener('abort', abort, { once: true })
        reader.readAsDataURL(blob)
      })
    })()
    cache.set(url.href, job)
    return job
  }

  const jobs = [...root.querySelectorAll<HTMLImageElement>('img[src]')].map(async image => {
    image.src = await load(image.src)
    await image.decode()
  })
  for (const image of root.querySelectorAll('svg image')) {
    const src = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (src) jobs.push(load(src).then(data => {
      image.setAttribute('href', data)
      image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
    }))
  }
  for (const node of root.querySelectorAll<StyledElement>('[style]')) {
    const background = node.style.backgroundImage
    const urls = [...background.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)]
    if (urls.length === 0) continue
    jobs.push(Promise.all(urls.map(match => load((match[1] ?? match[2] ?? match[3]).trim()))).then(images => {
      let css = background
      urls.forEach((match, index) => { css = css.replace(match[0], `url("${images[index]}")`) })
      node.style.backgroundImage = css
    }))
  }
  try { await Promise.all(jobs) }
  catch {
    signal.throwIfAborted()
    throw new Error('image-unavailable')
  }
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
  elements: readonly HTMLElement[], pixelRatio: number, cancel: AbortSignal, singleImage: boolean,
): Promise<Blob[]> {
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
    await waitForCapture(() => inlineImages(content, signal), signal)
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
    return images
  } finally {
    operation.abort()
    mount.remove()
  }
}
