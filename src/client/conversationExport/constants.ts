/**
 * 对话导出：常量与共享工具（移植原 conversationExport/constants.js）。
 * 文案改由词典注入（CeTexts），格式/主题/文件名清洗/时间格式化保持逐参数一致。
 */
import { ACTIVE_COLOR_PALETTE } from '../shared/palette.ts'

/** 导出文案面（原 CE_TEXT 的全部键，由组件用 t 构建）。 */
export interface CeTexts {
  readonly buttonTooltip: string
  readonly modalTitle: string
  readonly sectionRange: string
  readonly sectionFormat: string
  readonly sectionTheme: string
  readonly sectionList: string
  readonly rangeAll: string
  readonly rangeSelect: string
  readonly headerShowTime: string
  readonly headerShowConversationTime: string
  readonly askTimeLabel: string
  readonly selectAll: string
  readonly turnPrefix: string
  /** 角色标签（原版固定 Q / A，不走 i18n）。 */
  readonly exportRoleUser: string
  readonly exportRoleAssistant: string
  readonly emptyAssistant: string
  readonly emptyUserPreview: string
  readonly cancel: string
  readonly confirm: string
  readonly loading: string
  readonly loadingProgress: string
  readonly cancelLoading: string
  readonly exporting: string
  readonly done: string
  readonly failed: string
  readonly noConversation: string
  readonly needSelect: string
  readonly timeLabel: string
  readonly titleLabel: string
  readonly orderLabel: string
  readonly imageCannotEmbed: string
  readonly imageNotRendered: string
  readonly truncatedNotice: string
  readonly imageListTitle: string
  readonly defaultTitle: string
  readonly unknownSize: string
}

/** 导出格式定义（原 CE_FORMATS）。 */
export interface ExportFormat {
  readonly id: string
  readonly label: string
  /** 文件扩展名（含点）。 */
  readonly ext: string
  readonly mime: string
}

export const CE_FORMATS: readonly ExportFormat[] = [
  { id: 'markdown', label: 'Markdown', ext: '.md', mime: 'text/markdown' },
  { id: 'txt', label: 'TXT', ext: '.txt', mime: 'text/plain' },
  { id: 'json', label: 'JSON', ext: '.json', mime: 'application/json' },
  { id: 'csv', label: 'CSV', ext: '.csv', mime: 'text/csv' },
  { id: 'png', label: 'PNG', ext: '.png', mime: 'image/png' },
  { id: 'pdf', label: 'PDF', ext: '.pdf', mime: 'application/pdf' },
]

export const CE_DEFAULT_FORMAT = 'markdown'

/** PNG 图片主题（原 CE_THEMES：由 ACTIVE_COLOR_PALETTE 派生，头部文字统一白色）。 */
export interface ExportTheme {
  readonly id: string
  readonly textColor: string
  readonly solid?: string
  /** canvas 色标 [offset, color]。 */
  readonly gradient?: readonly (readonly [number, string])[]
}

export const CE_THEMES: readonly ExportTheme[] = ACTIVE_COLOR_PALETTE.map(entry => ({
  id: entry.id,
  textColor: '#ffffff',
  ...(entry.gradient !== undefined
    ? { gradient: entry.gradient.stops.map(stop => [stop[0], stop[1]] as const) }
    : { solid: entry.solid }),
}))

export const CE_DEFAULT_THEME = 'purple'

/** 文件名最大长度（不含扩展名，原 CE_MAX_FILENAME_LENGTH）。 */
export const CE_MAX_FILENAME_LENGTH = 80

/** 浏览器 canvas 高度的保守上限（原 CE_MAX_CANVAS_HEIGHT）。 */
export const CE_MAX_CANVAS_HEIGHT = 30000

/** 一张导出图片。 */
export interface ExportImage {
  readonly role: 'user' | 'assistant'
  /** 可加载的 URL（blob/data），空串表示未解析成功。 */
  readonly src: string
  readonly alt: string
  readonly width: number | null
  readonly height: number | null
  readonly fileId: string | null
  readonly unrendered: boolean
}

/** 一轮对话（原 turns 元素结构）。 */
export interface ExportTurn {
  readonly order: number
  readonly user: {
    readonly text: string
    readonly time: number
    readonly images: readonly ExportImage[]
  }
  readonly assistant: {
    readonly text: string
    readonly markdown: string
    readonly images: readonly ExportImage[]
  }
}

/** 导出任务元信息。 */
export interface ExportMeta {
  readonly title: string
  readonly platformId: string
  readonly platformName: string
  readonly exportTime: Date
}

/** 导出任务选项。 */
export interface ExportOptions {
  readonly showTime: boolean
  readonly showConversationTime: boolean
  readonly rangeId: string
  readonly formatId: string
}

/** 导出任务（原 job）。 */
export interface ExportJob {
  readonly meta: ExportMeta
  readonly options: ExportOptions
  readonly turns: readonly ExportTurn[]
}

/**
 * 按模板插值文案（原 ceFormatText）。
 * @param template - 含 {key} 占位符的模板。
 * @param params - 键值。
 */
export function ceFormatText(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ))
}

/**
 * 根据 id 取主题定义，找不到时回退默认（原 ceGetTheme）。
 * @param themeId - 主题 id。
 */
export function ceGetTheme(themeId: string): ExportTheme {
  return CE_THEMES.find(t => t.id === themeId)
    ?? CE_THEMES.find(t => t.id === CE_DEFAULT_THEME)
    ?? CE_THEMES[0]
}

/**
 * 清洗文件名（原 ceSanitizeFilename）：移除控制字符与文件系统保留字符并限长。
 * @param rawName - 原始标题。
 * @param fallback - 缺省文件名。
 */
export function ceSanitizeFilename(rawName: string, fallback: string): string {
  let name = rawName.trim()

  // eslint-disable-next-line no-control-regex
  name = name
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Windows 不允许文件名以点结尾。
  name = name.replace(/\.+$/, '').trim()

  if (name === '') name = fallback

  if (name.length > CE_MAX_FILENAME_LENGTH) {
    name = name.slice(0, CE_MAX_FILENAME_LENGTH).trim()
  }

  return name !== '' ? name : fallback
}

/**
 * 本地时间字符串 YYYY-MM-DD HH:mm:ss（原 ceFormatLocalTime）。
 * @param date - 时间（默认当前）。
 */
export function ceFormatLocalTime(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 提问时间 YYYY-MM-DD HH:mm（原 ceFormatChatTime，不含秒）。
 * @param timestamp - 毫秒时间戳。
 */
export function ceFormatChatTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
