/** html-to-image 1.11.13, from AIChatTimeline's MIT-licensed vendored build. */
export function toBlob(node: HTMLElement, options: {
  width: number
  height: number
  pixelRatio: number
  skipAutoScale: boolean
  fontEmbedCSS: string
  fetchRequestInit: RequestInit
  includeStyleProperties: string[]
}): Promise<Blob | null>

export function getFontEmbedCSS(node: HTMLElement, options: {
  preferredFontFormat: string
  fetchRequestInit: RequestInit
}): Promise<string>
