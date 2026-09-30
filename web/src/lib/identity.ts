import { PEOPLE_COLORS, type Participant } from '@tandem/shared'

import { newId } from './ids.ts'

export { PEOPLE_COLORS }

const KEY = 'tandem.identity'

export function loadIdentity(): Participant | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Participant>
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.color !== 'string')
      return null
    return { id: p.id, name: p.name, color: p.color }
  } catch {
    return null
  }
}

export function saveIdentity(p: Participant): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Private mode or blocked storage: the session still works, the name just is not remembered.
  }
}

export function newIdentity(name: string, color: string): Participant {
  const existing = loadIdentity()
  return { id: existing?.id ?? newId(), name, color }
}
