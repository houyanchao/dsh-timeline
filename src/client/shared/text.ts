/** 会话内容块的纯文本与时间格式化工具（时间轴各组件共用）。 */

/** 与 core ContentBlock 对齐的最小结构读取形态（本插件只读 text 块）。 */
interface TextishBlock {
  readonly type?: string
  readonly text?: string
}

/**
 * 把一条用户消息的内容块拼成摘要文本（保留原文，由 CSS 负责行数截断）。
 * @param content - 消息内容块（未知块被跳过）。
 * @param maxLength - 防御性最大长度（极端长文截断，默认 2000）。
 * @returns 摘要文本；无文本内容时返回空字符串。
 */
export function summarizeBlocks(content: readonly unknown[], maxLength = 2000): string {
  const text = content
    .map(block => (isTextBlock(block) ? block.text : ''))
    .join(' ')
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}

function isTextBlock(block: unknown): block is TextishBlock & { text: string } {
  return typeof block === 'object' && block !== null
    && (block as TextishBlock).type === 'text'
    && typeof (block as TextishBlock).text === 'string'
}

/** 与助手节点 blocks 对齐的最小读取形态。 */
interface AssistantTextishBlock {
  readonly kind?: string
  readonly text?: string
}

/**
 * 把助手消息的 text 块拼成预览（推理/工具块跳过）。
 * @param blocks - 助手 blocks。
 * @param maxLength - 防御性最大长度，默认 2000。
 * @returns 预览文本；无正文时返回空字符串。
 */
export function summarizeAssistantBlocks(blocks: readonly unknown[], maxLength = 2000): string {
  const text = blocks
    .map((block) => {
      if (typeof block !== 'object' || block === null) return ''
      const item = block as AssistantTextishBlock
      return item.kind === 'text' && typeof item.text === 'string' ? item.text : ''
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}

/**
 * 提问时间的展示格式（移植原扩展 ChatTimeRecorder.formatNodeTime）：
 * 今天只显示时分；今年显示月日时分；跨年补年份。
 * @param timestamp - Unix epoch ms。
 * @returns 格式化时间；无效时间返回空字符串。
 */
export function formatNodeTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const isThisYear = date.getFullYear() === now.getFullYear()

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (isThisYear) {
    return date.toLocaleDateString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * 完整年月日时分（移植原扩展 ChatTimeRecorder.formatFullNodeTime，
 * 时间标签点击展开用）。
 * @param timestamp - Unix epoch ms。
 * @returns `YYYY年MM月DD日 HH:mm`；无效时间返回空字符串。
 */
export function formatFullNodeTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 只有默认格式不显示年份（本年）的时间才支持点击切换完整格式
 * （移植原 isNodeTimeToggleable）。
 * @param timestamp - Unix epoch ms。
 */
export function isNodeTimeToggleable(timestamp: number): boolean {
  if (!timestamp) return false
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return false
  return date.getFullYear() === new Date().getFullYear()
}
