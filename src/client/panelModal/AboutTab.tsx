import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { LOGO_DATA_URL } from '../changelog/logo.ts'
import type { NS } from '../locales.ts'
import type { PluginInstaller } from '../shared/pluginInstaller.ts'
import { copyText } from '../starred/actions.tsx'
import { PluginRecommendations } from './PluginRecommendations.tsx'
import css from './about.module.css'

const repository = 'https://github.com/houyanchao/dsh-timeline'
const email = 'houyanchao@outlook.com'

export function AboutTab({ t, installer, openDataSync }: {
  readonly t: TranslateNS<typeof NS>
  readonly installer: PluginInstaller
  readonly openDataSync: () => void
}) {
  return (
    <div className={css.about}>
      <header className={css.intro}>
        <img src={LOGO_DATA_URL} alt="" width="48" height="48" />
        <div>
          <h3>dsh-timeline</h3>
          <p>{t('about.pluginContent')}</p>
          <div className={css.links}>
            <a href="https://timeline4ai.com/#/guide?section=timeline" target="_blank" rel="noopener noreferrer">{t('about.btnDocs')}</a>
            <a href={repository} target="_blank" rel="noopener noreferrer">{t('about.btnGithub')}</a>
          </div>
        </div>
      </header>
      <div className={css.details}>
        <section>
          <h3>{t('about.dataSecurityTitle')}</h3>
          <p>{t('about.dataSecurityContent')}</p>
          <div className={css.links}>
            <button type="button" onClick={openDataSync}>{t('panel.tabDataSync')}</button>
          </div>
        </section>
        <section>
          <h3>{t('about.developerTitle')}</h3>
          <p>{t('about.developerContent')}</p>
          <div className={css.links}>
            <a href={repository + '/issues'} target="_blank" rel="noopener noreferrer">{t('about.feedbackGithub')}</a>
            <button type="button" title={email} onClick={() => { void copyText(email, t) }}>{t('about.feedbackEmail')}</button>
          </div>
        </section>
      </div>
      <PluginRecommendations t={t} installer={installer} />
    </div>
  )
}
