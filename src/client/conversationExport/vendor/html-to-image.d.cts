/** html-to-image 1.11.13, from AIChatTimeline's MIT-licensed vendored build. */
export function toCanvas(node: HTMLElement, options: {
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
  pixelRatio: number
  skipAutoScale: boolean
  fontEmbedCSS: string
  fetchRequestInit: RequestInit
  includeStyleProperties: string[]
  style?: Partial<CSSStyleDeclaration>
}): Promise<HTMLCanvasElement>

export function getFontEmbedCSS(node: HTMLElement, options: {
  preferredFontFormat: string
  fetchRequestInit: RequestInit
}): Promise<string>
