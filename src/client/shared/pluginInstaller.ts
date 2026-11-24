import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'

const npmRegistry = 'https://registry.npmjs.org/'
const publishedVersion = /^\d+\.\d+\.\d+(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i

export type RecommendedPackageName = 'dsh-open-model' | 'dsh-use-chatgpt'

export interface PluginInstallState {
  readonly inventory: 'unavailable' | 'loading' | 'ready' | 'failed'
  readonly installed: ReadonlySet<string>
  readonly pending: RecommendedPackageName | null
  readonly error: { name: RecommendedPackageName; message?: string; problem?: string } | null
}

export interface PluginInstaller {
  getSnapshot(): PluginInstallState
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  install(name: RecommendedPackageName): Promise<void>
}

type RpcReply<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
interface Bundle {
  name: string
  installed: boolean
  availability: 'profile' | 'installation' | 'missing'
}
type Inspection =
  | { status: 'refused'; problem: string; reason: string }
  | { status: 'accepted'; registry: string | null; name?: string; version?: string; bundle: boolean | null }
interface ChangeResult {
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  error?: { diagnostic?: string; code: string }
}
interface InstallOptions {
  registry: string
  enabled: boolean
  expected: { name: string; version: string }
  requestId?: string
}

// The plugin manager is an optional service on the DSH versions Timeline supports.
interface PluginRemote {
  pluginManager: {
    listBundles(): Promise<RpcReply<Bundle[]>>
    inspect(spec: string, options: { registry: string }): Promise<RpcReply<Inspection>>
    installBundle(spec: string, options: InstallOptions): Promise<RpcReply<ChangeResult>>
    waitForInstall(requestId: string): Promise<RpcReply<ChangeResult | null>>
  }
  $on(event: 'plugin-manager/changed', listener: () => void): () => void
}

function rpcValue<T>(reply: RpcReply<T>): T {
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.value
}

/**
 * Create once in the client plugin's apply(ctx). Pass the instance to the
 * recommendations view and use useSyncExternalStore(installer.subscribe, installer.getSnapshot).
 */
export function createPluginInstaller(ctx: ClientContext): PluginInstaller {
  const initial: PluginInstallState = { inventory: 'unavailable', installed: new Set(), pending: null, error: null }
  const listeners = new Set<() => void>()
  let state = initial
  let connection: { manager: PluginRemote['pluginManager'] } | undefined
  let revision = 0

  function update(changes: Partial<PluginInstallState>): void {
    state = { ...state, ...changes }
    for (const listener of listeners) listener()
  }

  async function refresh(): Promise<void> {
    if (!connection) return
    const current = ++revision
    try {
      const bundles = rpcValue(await connection.manager.listBundles())
      if (current !== revision) return
      const installed = new Set(bundles.filter(item =>
        item.installed || item.availability === 'profile' || item.availability === 'installation',
      ).map(item => item.name))
      if (installed.has('@houyanchao/dsh-free-model')) installed.add('dsh-open-model')
      update({ inventory: 'ready', installed, error: state.error && installed.has(state.error.name) ? null : state.error })
    } catch {
      if (current === revision) update({ inventory: 'failed' })
    }
  }

  ctx.inject(['remote', 'remote.pluginManager'], scope => {
    scope.effect(() => {
      const remote = scope.get('remote') as typeof scope.remote & PluginRemote
      // Give each binding its own identity even if the host reuses the remote proxy.
      const active = { manager: remote.pluginManager }
      connection = active
      const recheck = (): void => { if (listeners.size) void refresh() }
      const unsubscribe = remote.$on('plugin-manager/changed', recheck)
      const reset = scope.on('connection/reset', recheck)
      globalThis.window?.addEventListener('focus', recheck)
      update({ ...initial, inventory: 'loading' })
      recheck()
      return () => {
        unsubscribe()
        reset()
        globalThis.window?.removeEventListener('focus', recheck)
        if (connection === active) {
          connection = undefined
          revision++
          update(initial)
        }
      }
    }, 'dsh-timeline: recommended plugin inventory')
  })

  async function install(name: RecommendedPackageName): Promise<void> {
    if (!connection || state.inventory !== 'ready' || state.pending || state.installed.has(name)) return
    const active = connection
    const { manager } = active
    update({ pending: name, error: null })
    try {
      const info = rpcValue(await manager.inspect(name, { registry: npmRegistry }))
      if (active !== connection) return
      if (info.status === 'refused') {
        update({ error: { name, problem: info.problem, message: info.reason } })
        return
      }
      if (info.registry !== npmRegistry || info.name !== name || info.bundle !== true
        || typeof info.version !== 'string' || !publishedVersion.test(info.version)) throw new Error()

      const requestId = globalThis.crypto?.randomUUID?.()
      const options: InstallOptions = {
        registry: npmRegistry,
        enabled: true,
        expected: { name, version: info.version },
        ...(requestId && { requestId }),
      }
      let result: ChangeResult | null
      try {
        result = rpcValue(await manager.installBundle(`${name}@${info.version}`, options))
      } catch (error) {
        // A lost reply can leave pnpm running. Join the same request before retrying.
        if (!requestId || active !== connection) throw error
        result = rpcValue(await manager.waitForInstall(requestId))
        if (!result) throw error
      }
      if (!['applied', 'restart-required', 'overridden'].includes(result.application)) {
        throw new Error(result.error?.diagnostic || result.error?.code)
      }
    } catch (error) {
      if (active === connection) update({ error: { name, message: error instanceof Error ? error.message : undefined } })
    } finally {
      if (active === connection) {
        await refresh()
        if (active === connection) update({ pending: null })
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) void refresh()
      return () => { listeners.delete(listener) }
    },
    refresh,
    install,
  }
}
