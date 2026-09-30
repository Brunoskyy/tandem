import type { Presence } from '@tandem/shared'

/** Other people's pointers, drawn inside the scrolling canvas so they stay put as you scroll. */
export function Cursors({ others }: { others: Presence[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {others.map(
        (p) =>
          p.cursor && (
            <div
              key={p.id}
              className="absolute transition-transform duration-75 ease-linear"
              style={{ transform: `translate(${p.cursor.x}px, ${p.cursor.y}px)` }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
                <path
                  d="M2 1 L16 8 L9 9.5 L6.5 16 Z"
                  fill={p.color}
                  stroke="white"
                  strokeWidth="1.2"
                />
              </svg>
              <span
                className="ml-3 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white"
                style={{ background: p.color }}
              >
                {p.name}
              </span>
            </div>
          ),
      )}
    </div>
  )
}
