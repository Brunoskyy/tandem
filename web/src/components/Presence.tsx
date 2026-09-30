import type { Participant, Presence as PresenceModel } from '@tandem/shared'

import type { Status } from '../sync/connection.ts'

interface Props {
  me: Participant
  others: PresenceModel[]
  status: Status
  pending: number
}

export function Presence({ me, others, status, pending }: Props) {
  const people = [me, ...others]
  return (
    <div className="flex items-center gap-2">
      <ul className="flex -space-x-1.5" aria-label={`${people.length} people here`}>
        {people.slice(0, 6).map((p) => (
          <li
            key={p.id}
            title={p.id === me.id ? `${p.name} (you)` : p.name}
            className="border-panel flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold text-white"
            style={{ background: p.color }}
          >
            {initials(p.name)}
          </li>
        ))}
        {people.length > 6 && (
          <li className="bg-muted border-panel flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs text-white">
            +{people.length - 6}
          </li>
        )}
      </ul>
      <StatusDot status={status} pending={pending} />
    </div>
  )
}

function StatusDot({ status, pending }: { status: Status; pending: number }) {
  const label =
    status === 'online'
      ? pending > 0
        ? `Saving ${pending} change${pending === 1 ? '' : 's'}`
        : 'Live'
      : status === 'connecting'
        ? 'Connecting'
        : `Offline, ${pending} change${pending === 1 ? '' : 's'} waiting`
  const color =
    status === 'online'
      ? pending > 0
        ? 'bg-amber-500'
        : 'bg-emerald-500'
      : status === 'connecting'
        ? 'bg-amber-500'
        : 'bg-danger'
  return (
    <span className="text-muted flex items-center gap-1.5 text-xs" role="status">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}
