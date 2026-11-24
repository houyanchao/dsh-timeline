import { useId, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import type { PluginInstaller, PluginInstallState, RecommendedPackageName } from '../shared/pluginInstaller.ts'
import { BrowserStoreLinks } from '../ui/BrowserStoreLinks.tsx'
import css from './about.module.css'

const plugins = [
  {
    title: 'dsh-open-model',
    name: 'dsh-open-model',
    description: 'recommend.freeModel',
    guide: 'https://github.com/houyanchao/dsh-open-model#在自研-dsh-客户端安装',
  },
  {
    title: 'dsh-use-chatgpt',
    name: 'dsh-use-chatgpt',
    description: 'recommend.useChatGPT',
    guide: 'https://github.com/houyanchao/dsh-use-chatgpt#从源码安装',
  },
] as const

function buttonState(name: RecommendedPackageName, state: PluginInstallState) {
  if (state.pending === name) return 'installing'
  if (state.inventory === 'unavailable') return 'unavailable'
  if (state.inventory === 'failed') return 'retry'
  if (state.inventory === 'loading') return 'checking'
  if (state.installed.has(name)) return 'installed'
  return 'install'
}

export function PluginRecommendations({ t, installer }: {
  readonly t: TranslateNS<typeof NS>
  readonly installer: PluginInstaller
}) {
  const headingId = useId()
  const state = useSyncExternalStore(installer.subscribe, installer.getSnapshot)

  return (
    <section className={css.recommendations} aria-labelledby={headingId}>
      <h3 id={headingId}>{t('recommend.title')}</h3>
      <ul className={css.pluginList}>
        {plugins.map(({ title, name, description, guide }) => {
          const action = buttonState(name, state)
          const label = t(`recommend.${action}`)
          const error = state.error?.name === name && !state.installed.has(name) ? state.error : null
          return (
            <li key={name} className={css.pluginRow}>
              <div><strong>{title}</strong><p>{t(description)}</p></div>
              <div className={css.pluginActions} aria-live="polite">
                <button
                  type="button"
                  className={css.pluginAction}
                  data-state={action}
                  aria-label={t('recommend.action', { name: title, action: label })}
                  disabled={state.pending !== null || (action !== 'install' && action !== 'retry')}
                  onClick={() => { void (action === 'retry' ? installer.refresh() : installer.install(name)) }}
                >{label}</button>
              </div>
              {error && (
                <p className={css.pluginError} role="alert">
                  {error.problem === 'not-found' ? <>
                    {t('recommend.notFound', { name })}{' '}
                    <a href={guide} target="_blank" rel="noopener noreferrer">{t('recommend.guide')}</a>
                  </> : <>{t('recommend.installError')} {error.message}</>}
                </p>
              )}
            </li>
          )
        })}
        <li className={css.pluginRow}>
          <div><strong>timeline</strong><p>{t('recommend.browser')}</p></div>
          <div className={css.pluginActions}>
            <BrowserStoreLinks t={t} className={css.pluginAction} compact />
          </div>
        </li>
      </ul>
      {state.inventory === 'failed' && <p className={css.pluginError} role="alert">{t('recommend.inventoryError')}</p>}
    </section>
  )
}
