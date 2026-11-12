export function SettingsIcon({ strokeWidth = 2 }: { readonly strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.91 2.34 2.34 0 0 1 2.33 4.04 2.34 2.34 0 0 0 0 3.82 2.34 2.34 0 0 1-2.33 4.04 2.34 2.34 0 0 0-3.32 1.91 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.91 2.34 2.34 0 0 1-2.33-4.04 2.34 2.34 0 0 0 0-3.82 2.34 2.34 0 0 1 2.33-4.04 2.34 2.34 0 0 0 3.32-1.91Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
