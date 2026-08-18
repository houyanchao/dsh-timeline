/**
 * 数据导入导出（移植原 panelModal/tabs/dataSync 的本地文件部分，
 * Google Drive 云同步按需求不迁移）。
 * - 导出：把插件全部 localStorage 数据打包为 { _meta, data } JSON 文件下载；
 * - 导入：从 JSON 文件恢复，支持合并/覆盖两种模式（合并规则逐条对齐原
 *   mergeByKey：收藏按 key、图钉按 key、提示词按 id、文件夹按 id、设置对象
 *   按 key 合并、其他新值覆盖）。
 * 存储层适配：原 chrome.storage.local 改为 localStorage；覆盖模式只清插件
 * 自有前缀的 key（localStorage 与宿主共享，不能整库 clear）。
 */

/** 备份文件元数据（原 _buildMeta）。 */
interface BackupMeta {
  readonly source: string
  readonly appVersion: string
  readonly exportTime: string
  readonly exportTimestamp: number
}

/** 备份文件结构。 */
interface BackupFile {
  readonly _meta?: BackupMeta
  readonly data: Record<string, unknown>
}

/** 来源指纹（原 'AIChatTimeline'；DSH 存储结构不同，用独立指纹防止混导）。 */
const BACKUP_SOURCE = 'AIChatTimeline-DSH'
/** 插件版本（原 chrome.runtime.getManifest().version）。 */
const APP_VERSION = '0.1.0'

/** 插件自有存储 key 前缀（导出/覆盖清理的圈定范围）。 */
const KEY_PREFIXES = ['dsh.timeline.'] as const

/** 各 key 的合并策略所需的字段名（原 mergeByKey 的 DSH key 映射）。 */
const STARRED_KEY = 'dsh.timeline.starred'
const PINS_KEY = 'dsh.timeline.pins'
const PROMPTS_KEY = 'dsh.timeline.prompts'
const SETTINGS_KEY = 'dsh.timeline.settings'

/** 是否插件自有 key。 */
function isPluginKey(key: string): boolean {
  return KEY_PREFIXES.some(prefix => key.startsWith(prefix))
}

/** localStorage 字符串值 → 结构化值（JSON 解析失败时保留原始字符串）。 */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** 结构化值 → localStorage 字符串值（字符串原样写回，与 parseValue 对偶）。 */
function serializeValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** 获取所有插件存储数据（原 getAllStorageData：过滤非本插件 key）。 */
export function getAllStorageData(): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key === null || !isPluginKey(key)) continue
    const raw = localStorage.getItem(key)
    if (raw !== null) data[key] = parseValue(raw)
  }
  return data
}

/** 构建备份文件元数据（原 _buildMeta）。 */
function buildMeta(): BackupMeta {
  return {
    source: BACKUP_SOURCE,
    appVersion: APP_VERSION,
    exportTime: new Date().toISOString(),
    exportTimestamp: Date.now(),
  }
}

/**
 * 校验是否是合法的本插件备份（原 _isValidBackup）。
 * - data 必须是对象；
 * - 若带 _meta，则 source 必须为本插件指纹（缺 _meta 时放行，兼容早期备份）。
 */
export function isValidBackup(importData: unknown): importData is BackupFile {
  if (importData === null || typeof importData !== 'object') return false
  const candidate = importData as { data?: unknown; _meta?: { source?: unknown } }
  if (candidate.data === null || typeof candidate.data !== 'object') return false
  const meta = candidate._meta
  if (meta !== undefined && meta.source !== undefined && meta.source !== BACKUP_SOURCE) return false
  return true
}

/** 格式化日期（原 formatDate：YYYYMMDD-HHmm）。 */
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}${m}${d}-${h}${min}`
}

/** 导出数据为 JSON 文件下载（原 handleExport 的数据与下载部分）。 */
export function exportDataToFile(): void {
  const exportData: BackupFile = {
    _meta: buildMeta(),
    data: getAllStorageData(),
  }

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ai-timeline-backup-${formatDate(new Date())}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 按指定字段合并数组（原 mergeArrayByField：导入数据覆盖现有数据）。
 * @param existing - 现有数据。@param newArr - 导入数据。@param field - 唯一标识字段名。
 * @returns 合并后的数组。
 */
function mergeArrayByField(existing: unknown, newArr: unknown, field: string): unknown {
  if (!Array.isArray(existing) || !Array.isArray(newArr)) return newArr

  const map = new Map<unknown, unknown>()
  for (const item of existing) {
    const key = (item as Record<string, unknown>)[field]
    if (key !== undefined) map.set(key, item)
  }
  // 导入数据覆盖（相同 key 的会被覆盖）。
  for (const item of newArr) {
    const key = (item as Record<string, unknown>)[field]
    if (key !== undefined) map.set(key, item)
  }
  return Array.from(map.values())
}

/** 对象按 key 浅合并（原 *PlatformSettings 规则）。 */
function mergeObject(existing: unknown, newValue: unknown): unknown {
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) return newValue
  if (newValue === null || typeof newValue !== 'object' || Array.isArray(newValue)) return newValue
  return { ...(existing as Record<string, unknown>), ...(newValue as Record<string, unknown>) }
}

/**
 * 根据 key 类型选择合并策略（原 mergeByKey 的 DSH key 映射）。
 * - 收藏存储（folders + items 复合对象）：folders 按 id、items 按 key 分别合并
 *   （对应原 folders / chatTimelineStars 两条规则）；
 * - 图钉：按 key 合并（原 chatTimelinePins）；
 * - 提示词：按 id 合并（原 prompts）；
 * - 设置：对象按 key 合并（原 *PlatformSettings）；
 * - 其他：新值覆盖。
 */
function mergeByKey(key: string, existing: unknown, newValue: unknown): unknown {
  if (key === STARRED_KEY) {
    const existingState = (existing ?? {}) as { folders?: unknown; items?: unknown }
    const newState = (newValue ?? {}) as { folders?: unknown; items?: unknown }
    // 备份缺某字段时保留现有值（防止 mergeArrayByField 透传 undefined 清空数据），
    // 其余未知字段经展开保留。
    return {
      ...existingState,
      ...newState,
      folders: newState.folders === undefined
        ? existingState.folders
        : mergeArrayByField(existingState.folders, newState.folders, 'id'),
      items: newState.items === undefined
        ? existingState.items
        : mergeArrayByField(existingState.items, newState.items, 'key'),
    }
  }

  if (key === PINS_KEY) {
    return mergeArrayByField(existing, newValue, 'key')
  }

  if (key === PROMPTS_KEY) {
    return mergeArrayByField(existing, newValue, 'id')
  }

  if (key === SETTINGS_KEY) {
    return mergeObject(existing, newValue)
  }

  // 其他类型 - 新值覆盖。
  return newValue
}

/** 覆盖模式：清空插件数据并写入新数据（原 overwriteData，clear 圈定插件前缀）。 */
export function overwriteData(newData: Record<string, unknown>): void {
  // 先清空插件自有 key（等价原 chrome.storage.local.clear 的插件作用域版）。
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key !== null && isPluginKey(key)) toRemove.push(key)
  }
  for (const key of toRemove) localStorage.removeItem(key)

  // 再写入（忽略非本插件前缀的 key，防止污染宿主存储）。
  for (const [key, value] of Object.entries(newData)) {
    if (!isPluginKey(key)) continue
    localStorage.setItem(key, serializeValue(value))
  }
}

/** 合并模式：智能合并数据（原 mergeData）。 */
export function mergeData(newData: Record<string, unknown>): void {
  const existingData = getAllStorageData()

  for (const [key, newValue] of Object.entries(newData)) {
    if (!isPluginKey(key)) continue
    const existingValue = existingData[key]

    // 本地不存在，直接使用新值；否则按 key 类型合并。
    const merged = existingValue === undefined ? newValue : mergeByKey(key, existingValue, newValue)
    localStorage.setItem(key, serializeValue(merged))
  }
}
