/** 收藏体系共用 SVG 图标：逐路径移植原扩展 starred-tree-renderer 内联 SVG。 */

/** 闭合文件夹（渐变填充；Mac 蓝 / 默认黄由 CSS 变量控制）。 */
export function FolderClosedIcon({ gradientId }: { readonly gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--folder-gradient-top)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--folder-gradient-bottom)' }} />
        </linearGradient>
      </defs>
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill={`url(#${gradientId})`} />
    </svg>
  )
}

/** 展开文件夹（渐变描边）。 */
export function FolderOpenIcon({ gradientId }: { readonly gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--folder-gradient-top)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--folder-gradient-bottom)' }} />
        </linearGradient>
      </defs>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke={`url(#${gradientId})`} strokeWidth="2" fill="none" />
    </svg>
  )
}

/** 折叠三角（右向，展开时 CSS 旋转 90°）。 */
export function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

/** 三个点（更多操作）。 */
export function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

/** 置顶图钉（黄色，pinned 标识）。 */
export function PinIndicatorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2.5" aria-hidden>
      <line x1="5" y1="3" x2="19" y2="3" />
      <line x1="12" y1="7" x2="12" y2="21" />
      <polyline points="8 11 12 7 16 11" />
    </svg>
  )
}

/** 置顶（菜单项）。 */
export function PinMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="3" x2="19" y2="3" />
      <line x1="12" y1="7" x2="12" y2="21" />
      <polyline points="8 11 12 7 16 11" />
    </svg>
  )
}

/** 编辑（菜单项）。 */
export function EditMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

/** 删除（菜单项）。 */
export function DeleteMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

/** 新建子文件夹（菜单项）。 */
export function NewSubfolderMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  )
}

/** 文件夹轮廓（菜单项）。 */
export function FolderOutlineMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

/** 移动（菜单项，双向箭头）。 */
export function MoveMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

/** 复制（菜单项）。 */
export function CopyMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** 取消收藏（橙色实心星）。 */
export function UnstarMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="rgb(255, 125, 3)" stroke="rgb(255, 125, 3)" strokeWidth="0.5" aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

/** 会话气泡（收藏项 logo，DSH 内所有收藏都指向本站会话）。 */
export function ChatBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

/** 闪记笔记项图标（铅笔，原 notepad: 前缀项的内置 SVG logo）。 */
export function NotepadItemIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

/** 节点级收藏激活角标（右向小三角）。 */
export function ActiveMarkerIcon() {
  return (
    <svg viewBox="0 0 8 10" width="8" height="10" fill="currentColor" aria-hidden>
      <path d="M0 0l8 5-8 5z" />
    </svg>
  )
}
