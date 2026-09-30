import type { Toast } from '../sync/store.ts'

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 flex-col gap-2"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="bg-ink text-paper pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg"
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="text-accent font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                t.action?.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
