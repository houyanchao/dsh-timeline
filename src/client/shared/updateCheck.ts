import { useEffect, useSyncExternalStore } from 'react'
import { Bus } from '../ui/bus.ts'
import { PLUGIN_VERSION } from './version.ts'

const LATEST_URL = 'https://registry.npmjs.org/dsh-timeline/latest'
const CACHE_MS = 24 * 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000
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
let checking = false
let checkAgainAt = 0

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
    checkAgainAt = Date.now() + CACHE_MS
    availableUpdate.set(isNewer(latest, currentVersion) ? version : null)
  } catch {
    checkAgainAt = Date.now() + RETRY_MS
    availableUpdate.set(null)
  } finally {
    checking = false
  }
}

/** 在显示更新标签的面板打开时检查，两处入口共享请求和结果。 */
export function useAvailableUpdate(): string | null {
  useEffect(() => { void checkForUpdate() }, [])
  return useSyncExternalStore(availableUpdate.subscribe, getAvailableUpdate)
}
