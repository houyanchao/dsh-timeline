import { markUpdateSeen, useAvailableUpdate } from '../shared/updateCheck.ts'
import css from './availableUpdateBadge.module.css'

export type OpenPluginVersions = (closePanel: () => void) => void

export function AvailableUpdateBadge({ label, title, onClick, compact = false, dark = false }: {
  readonly label: string
  readonly title: string
  readonly onClick: () => void
  readonly compact?: boolean
  readonly dark?: boolean
}) {
  const version = useAvailableUpdate()
  if (version === null) return null

  return (
    <button
      type="button"
      className={css.badge}
      title={title}
      onClick={() => {
        markUpdateSeen(version)
        onClick()
      }}
      data-compact={compact || undefined}
      data-theme={dark ? 'dark' : undefined}
      data-update-available
    >
      <span>{label}</span>
      <span className={css.release}>
        <span aria-hidden="true">↑</span>
        <span className={css.version} title={`v${version}`}>{`v${version}`}</span>
      </span>
    </button>
  )
}
