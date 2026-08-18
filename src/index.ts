/**
 * dsh-timeline，Node 半：本插件只有浏览器 UI，host 侧无行为。
 * 浏览器半见 src/client/（由 package.json 的 dsh.client manifest 声明）。
 */

export const name = 'dsh-timeline'

/** Host plugin body — no host-side behavior for this UI-only plugin. */
export function apply(): void {}
