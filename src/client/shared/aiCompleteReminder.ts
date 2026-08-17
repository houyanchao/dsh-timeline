/**
 * AI 回复完成提醒（移植原 global/ai-complete-reminder-toast + playAICompleteSound）。
 * 右上角胶囊 toast（fixed 锚点 top:72px right:26px，向左弹出）+ 可选提示音。
 * 真实提醒（生成结束且用户不在最后节点）与设置面板预览共用。
 */
import { toast } from '../ui/toast.tsx'
import { DONE_SOUND_DATA_URL } from './doneSound.ts'

/** 锚点元素 class（原 ait-timeline-ai-complete-toast-anchor）。 */
const ANCHOR_CLASS = 'dsh-tl-ai-complete-toast-anchor'

/** 获取/创建右上角固定锚点（原 getAnchor）。 */
function getAnchor(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`.${ANCHOR_CLASS}`)
  if (existing !== null && existing.isConnected) return existing

  const anchor = document.createElement('div')
  anchor.className = ANCHOR_CLASS
  anchor.style.cssText = [
    'position: fixed',
    'top: 72px',
    'right: 26px',
    'width: 1px',
    'height: 1px',
    'pointer-events: none',
    'z-index: 2147483647',
  ].join(';')
  document.body.appendChild(anchor)
  return anchor
}

/**
 * 显示完成提醒 toast（原 AICompleteReminderToast.show）。
 * @param message - 本地化文案（原 timelineAICompleteNotLatestToast）。
 */
export function showAiCompleteToast(message: string): void {
  toast.info(message, getAnchor(), {
    duration: 3500,
    iconType: 'check',
    color: false,
    className: 'ait-ai-complete-toast',
    useClassStyles: true,
    position: 'left',
    gap: 10,
  })
}

/** 当前播放中的提示音实例（原 this.aiCompleteAudio，destroy 时 pause）。 */
let currentAudio: HTMLAudioElement | null = null

/** 播放完成提示音（原 playAICompleteSound，volume 0.45）。 */
export function playAiCompleteSound(): void {
  try {
    const audio = new Audio(DONE_SOUND_DATA_URL)
    audio.volume = 0.45
    currentAudio = audio
    void audio.play().catch(() => { /* 自动播放被浏览器拦截时静默 */ })
  } catch { /* 静默 */ }
}

/** 停止提示音（原 timeline destroy 中的 aiCompleteAudio.pause()）。 */
export function stopAiCompleteSound(): void {
  try {
    currentAudio?.pause()
    currentAudio = null
  } catch { /* 静默 */ }
}

/** 移除锚点（原 removeAnchor，时间轴卸载时调用）。 */
export function removeAiCompleteAnchor(): void {
  document.querySelectorAll(`.${ANCHOR_CLASS}`).forEach(el => { el.remove() })
}
