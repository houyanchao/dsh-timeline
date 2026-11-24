import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'

const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/timeline-ai-chat/fgebdnlceacaiaeikopldglhffljjlhh'
const EDGE_STORE_URL = 'https://microsoftedge.microsoft.com/addons/detail/ekednjjojnhlajfobalaaihkibbdcbab'

export function BrowserStoreLinks({ t, className, compact = false }: {
  readonly t: TranslateNS<typeof NS>
  readonly className: string
  readonly compact?: boolean
}) {
  return (
    <>
      <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className={className}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <path d="M21.17 8H12M3.95 6.06 8.54 14m2.34 7.94L15.46 14" />
        </svg>
        {t(compact ? 'browser.chromeEdition' : 'browser.tryChrome')}
      </a>
      <a href={EDGE_STORE_URL} target="_blank" rel="noopener noreferrer" className={className}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden>
          <path d="M2 12a10 10 0 1 1 19.6 2.8h-11a4.5 4.5 0 0 0 4.5 4H20a10 10 0 0 1-18-6.8Zm0 0c2-2.5 5.5-4.2 9-4.2 2.8 0 4.7 1.5 4.7 3.1 0 1.2-.9 2.1-2 2.1-1.2 0-2.2.7-3.1 1.8" />
        </svg>
        {t(compact ? 'browser.edgeEdition' : 'browser.tryEdge')}
      </a>
    </>
  )
}
