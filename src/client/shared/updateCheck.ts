import { useEffect, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { Bus } from '../ui/bus.ts'
import { registerStorageSync } from './storageSync.ts'
import { PLUGIN_VERSION } from './version.ts'

const PACKAGE_URL = 'https://registry.npmjs.org/dsh-timeline'
const LATEST_URL = `${PACKAGE_URL}/latest`
const CACHE_MS = 24 * 60 * 60 * 1000
const MIN_RELEASE_AGE_MS = 24 * 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000
const SEEN_VERSION_KEY = 'dsh.timeline.update.seenVersion'
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const NUMERIC = /^\d+$/

interface Version {
  readonly major: string
  readonly minor: string
  readonly patch: string
  readonly prerelease: readonly string[]
}

function parseVersion(value: string): Version | null {
  const match = SEMVER.exec(value)
  if (match === null || match[0] !== value) return null
  const [, major, minor, patch, suffix] = match
  const prerelease = suffix?.split('.') ?? []
  if (prerelease.some(id => /^0\d+$/.test(id))) return null
  return { major, minor, patch, prerelease }
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNewer(latest: Version, current: Version): boolean {
  const coreOrder = compareNumeric(latest.major, current.major)
    || compareNumeric(latest.minor, current.minor)
    || compareNumeric(latest.patch, current.patch)
  if (coreOrder !== 0) return coreOrder > 0

  const left = latest.prerelease
  const right = current.prerelease
  if (left.length === 0 || right.length === 0) return left.length === 0 && right.length > 0
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue
    const leftIsNumeric = NUMERIC.test(left[i])
    const rightIsNumeric = NUMERIC.test(right[i])
    if (leftIsNumeric && rightIsNumeric) return compareNumeric(left[i], right[i]) > 0
    if (leftIsNumeric !== rightIsNumeric) return rightIsNumeric
    return left[i] > right[i]
  }
  return left.length > right.length
}

const currentVersion = parseVersion(PLUGIN_VERSION)
const availableUpdate = new Bus<string | null>(null)
const getAvailableUpdate = () => availableUpdate.get()
const seenVersion = new Bus<Version | null>(readSeenVersion())
const getSeenVersion = () => seenVersion.get()
registerStorageSync(SEEN_VERSION_KEY, () => { seenVersion.set(readSeenVersion()) })
let checking = false
let checkAgainAt = 0

function readSeenVersion(): Version | null {
  try {
    const value = localStorage.getItem(SEEN_VERSION_KEY)
    return value === null ? null : parseVersion(value)
  } catch {
    return null
  }
}

async function checkForUpdate(): Promise<void> {
  if (currentVersion === null || checking || Date.now() < checkAgainAt) return
  checking = true
  try {
    const response = await fetch(LATEST_URL, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('npm version check failed')
    const data = await response.json() as { readonly version?: unknown } | null
    const version = data?.version
    if (typeof version !== 'string') throw new Error('Missing npm version')
    const latest = parseVersion(version)
    if (latest === null) throw new Error('Invalid npm version')

    if (!isNewer(latest, currentVersion)) {
      checkAgainAt = Date.now() + CACHE_MS
      availableUpdate.set(null)
      return
    }

    const packageResponse = await fetch(PACKAGE_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!packageResponse.ok) throw new Error('npm publication date check failed')
    const metadata = await packageResponse.json() as { readonly time?: Readonly<Record<string, unknown>> } | null
    const publishedAt = metadata?.time?.[version]
    const publishedAtMs = typeof publishedAt === 'string' ? Date.parse(publishedAt) : NaN
    if (!Number.isFinite(publishedAtMs)) throw new Error('Invalid npm publication date')

    const now = Date.now()
    const eligibleAt = publishedAtMs + MIN_RELEASE_AGE_MS
    const eligible = now >= eligibleAt
    const cacheExpiresAt = now + CACHE_MS
    checkAgainAt = eligible ? cacheExpiresAt : Math.min(cacheExpiresAt, eligibleAt)
    availableUpdate.set(eligible ? version : null)
  } catch {
    checkAgainAt = Date.now() + RETRY_MS
    availableUpdate.set(null)
  } finally {
    checking = false
  }
}

export function bindUpdateCheck(ctx: ClientContext): void {
  ctx.effect(() => {
    const refresh = (): void => { void checkForUpdate() }
    refresh()
    const timer = window.setInterval(refresh, RETRY_MS)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, 'dsh-timeline: npm update check')
}

/** 各入口共享 npm 最新版检测结果。 */
export function useAvailableUpdate(): string | null {
  useEffect(() => { void checkForUpdate() }, [])
  return useSyncExternalStore(availableUpdate.subscribe, getAvailableUpdate)
}

export function useUnseenUpdate(): string | null {
  const version = useAvailableUpdate()
  const seen = useSyncExternalStore(seenVersion.subscribe, getSeenVersion)
  if (version === null || seen === null) return version
  const latest = parseVersion(version)
  return latest !== null && isNewer(latest, seen) ? version : null
}

export function markUpdateSeen(version: string): void {
  const latest = parseVersion(version)
  const seen = seenVersion.get()
  if (latest === null || (seen !== null && !isNewer(latest, seen))) return

  // 另一个窗口可能已确认更高版本，读回持久记录再写入。
  const stored = readSeenVersion()
  if (stored !== null && !isNewer(latest, stored)) {
    seenVersion.set(stored)
    return
  }

  try { localStorage.setItem(SEEN_VERSION_KEY, version) } catch { /* 当前窗口仍可消除提示 */ }
  seenVersion.set(latest)
}
