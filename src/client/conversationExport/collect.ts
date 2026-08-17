/**
 * 对话导出：数据采集。原扩展的 adapters 通过 DOM 爬取 + 滚动加载采集对话；
 * DSH 下完整对话已在会话快照（chat.order/nodes）中，等价于原 STATIC 策略：
 * 直接读取节点配对成轮次，图片经 readAttachment 解析成 blob URL。
 */
import type { ChatNodeStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ExportImage, ExportTurn } from './constants.ts'

/** 一次 readAttachment 解析结果的最小形态。 */
export interface ResolvedAttachment {
  readonly mediaType: string
  readonly width: number
  readonly height: number
  readonly name?: string
  readonly data: Uint8Array
}

/** 会话图片解析器（由 ctx.sessions.binding(id).session.readAttachment 注入）。 */
export type AttachmentResolver = (attachmentId: string) => Promise<ResolvedAttachment | null>

/** 计入轮次的用户输入节点类别（与时间轴一致：提问 + 轮中追问）。 */
const USER_KINDS = new Set(['user', 'steering'])

/** 与 user/steering 节点 content 块对齐的最小读取形态。 */
interface TextishBlock {
  readonly type?: string
  readonly text?: string
  readonly attachment?: {
    readonly attachmentId?: string
    readonly width?: number
    readonly height?: number
    readonly name?: string
  }
}

interface UserLikeData {
  readonly content?: readonly unknown[]
  readonly time?: number
}

interface AssistantLikeData {
  readonly blocks?: readonly {
    readonly kind?: string
    readonly text?: string
    readonly attachment?: {
      readonly attachmentId?: string
      readonly width?: number
      readonly height?: number
      readonly name?: string
    }
  }[]
}

interface MutableTurn {
  order: number
  userText: string
  userTime: number
  userImages: ExportImage[]
  assistantParts: string[]
  assistantImages: ExportImage[]
}

/** 采集进度/取消回调（对齐原 collectAllTurns 的 options）。 */
export interface CollectOptions {
  readonly onProgress?: (count: number) => void
  readonly shouldCancel?: () => boolean
}

function userBlockText(block: unknown): string {
  const b = block as TextishBlock
  return typeof b === 'object' && b !== null && b.type === 'text' && typeof b.text === 'string' ? b.text : ''
}

/**
 * 从会话快照采集全部轮次（原 collectAllTurns 的 DSH 等价实现）。
 * @param order - chat.order 节点键序。
 * @param nodes - chat.nodes 节点表。
 * @param resolveAttachment - 图片字节解析器。
 * @param options - 进度与取消回调。
 * @returns 轮次数组（用户消息为界，其后的助手消息并入该轮）。
 */
export async function collectAllTurns(
  chatOrder: readonly string[],
  nodes: ChatNodeStore,
  resolveAttachment: AttachmentResolver,
  options: CollectOptions = {},
): Promise<ExportTurn[]> {
  const mutables: MutableTurn[] = []
  let current: MutableTurn | null = null
  const pendingImages: { image: ExportImage; attachmentId: string; assign: (img: ExportImage) => void }[] = []

  for (const key of chatOrder) {
    const node = nodes.get(key)
    if (node === undefined) continue

    if (USER_KINDS.has(node.kind)) {
      const data = node.data as UserLikeData
      const content = data.content ?? []
      const text = content.map(userBlockText).filter(t => t !== '').join('\n\n').trim()
      current = {
        order: mutables.length + 1,
        userText: text,
        userTime: data.time ?? 0,
        userImages: [],
        assistantParts: [],
        assistantImages: [],
      }
      mutables.push(current)
      // 用户消息中的图片块（image 类型 content block）。
      for (const block of content) {
        const b = block as TextishBlock
        if (typeof b === 'object' && b !== null && b.type === 'image' && b.attachment?.attachmentId !== undefined) {
          const image: ExportImage = {
            role: 'user',
            src: '',
            alt: b.attachment.name ?? '',
            width: b.attachment.width ?? null,
            height: b.attachment.height ?? null,
            fileId: b.attachment.attachmentId,
            unrendered: true,
          }
          const turn = current
          const index = turn.userImages.length
          turn.userImages.push(image)
          pendingImages.push({
            image,
            attachmentId: b.attachment.attachmentId,
            assign: (img) => { turn.userImages[index] = img },
          })
        }
      }
      options.onProgress?.(mutables.length)
      continue
    }

    if (node.kind === 'assistant' && current !== null) {
      const data = node.data as AssistantLikeData
      for (const block of data.blocks ?? []) {
        if (block.kind === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          current.assistantParts.push(block.text)
        } else if (block.kind === 'image' && block.attachment?.attachmentId !== undefined) {
          const image: ExportImage = {
            role: 'assistant',
            src: '',
            alt: block.attachment.name ?? '',
            width: block.attachment.width ?? null,
            height: block.attachment.height ?? null,
            fileId: block.attachment.attachmentId,
            unrendered: true,
          }
          const turn = current
          const index = turn.assistantImages.length
          turn.assistantImages.push(image)
          pendingImages.push({
            image,
            attachmentId: block.attachment.attachmentId,
            assign: (img) => { turn.assistantImages[index] = img },
          })
        }
      }
    }
  }

  // 解析图片为 blob URL（原 SCROLL 策略在此处等待 DOM 渲染，这里等待字节解析）。
  await Promise.all(pendingImages.map(async ({ image, attachmentId, assign }) => {
    if (options.shouldCancel?.() === true) return
    try {
      const resolved = await resolveAttachment(attachmentId)
      if (resolved === null) return
      const blob = new Blob([resolved.data as BlobPart], { type: resolved.mediaType })
      assign({
        ...image,
        src: URL.createObjectURL(blob),
        width: resolved.width,
        height: resolved.height,
        unrendered: false,
      })
    } catch { /* 解析失败保持 unrendered */ }
  }))

  if (options.shouldCancel?.() === true) return []

  const turns: ExportTurn[] = []
  for (const m of mutables) {
    // 过滤过小的装饰图（原 CE_MIN_IMAGE_SIZE：任一边 <48 且尺寸已知时跳过）。
    const userImages = m.userImages.filter(img => !isDecorativeImage(img))
    const assistantImages = m.assistantImages.filter(img => !isDecorativeImage(img))
    const markdown = m.assistantParts.join('\n\n').trim()
    const text = markdownToPlainText(markdown)
    // 全空轮丢弃（原 extractTurn：文本与图片四者全空时返回 null），序号保持连续。
    if (m.userText === '' && userImages.length === 0 && text === '' && assistantImages.length === 0) continue
    turns.push({
      order: turns.length + 1,
      user: { text: m.userText, time: m.userTime, images: userImages },
      assistant: { markdown, text, images: assistantImages },
    })
  }
  return turns
}

/** 过小的装饰图判定（原 _extractImageInfo：尺寸未知时保留）。 */
const MIN_IMAGE_SIZE = 48

function isDecorativeImage(img: ExportImage): boolean {
  const width = img.width ?? 0
  const height = img.height ?? 0
  return width > 0 && height > 0 && (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE)
}

/**
 * Markdown → 纯文本（原 adapters 由 DOM innerText 提供；此处从 markdown 剥离标记，
 * 覆盖：代码围栏（含未闭合）、块级/行内公式定界符、表格（分隔行丢弃、单元格转制表符）、
 * 分隔线、标题、图片/链接、行内标记、引用、列表符号）。
 */
export function markdownToPlainText(markdown: string): string {
  const withoutBlocks = markdown
    // 代码围栏（未闭合的也剥离，保留代码内容）
    .replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, '$1')
    // 公式定界符：$$...$$、\[...\]、\(...\)，保留内部内容
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\\\((.*?)\\\)/g, '$1')

  // 表格：分隔行丢弃，单元格行转为制表符分隔（近似原 innerText 的表格文本）
  const withoutTables = withoutBlocks.split('\n').flatMap((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && /^\|?[\s:|-]+$/.test(trimmed)) return []
    if (trimmed.startsWith('|')) {
      return [trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()).join('\t')]
    }
    return [line]
  }).join('\n')

  return withoutTables
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^(\s*)[-*+]\s+/gm, '$1- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
