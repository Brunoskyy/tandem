export type Id = string

export type NoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'purple'
export const NOTE_COLORS: readonly NoteColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
  'purple',
]

export interface Column {
  id: Id
  title: string
  /** Fractional position; see `between` in order.ts. */
  order: number
}

export interface Note {
  id: Id
  columnId: Id
  text: string
  color: NoteColor
  order: number
  authorId: Id
  /** Participant ids that voted. A set, so concurrent votes never clobber each other. */
  votes: Record<Id, true>
  createdAt: number
  updatedAt: number
}

/**
 * `write`: notes show only to their author, so nobody anchors on the first
 * card. `discuss`: everything is visible and voting opens.
 */
export type Phase = 'write' | 'discuss'

export interface BoardState {
  id: Id
  title: string
  phase: Phase
  /** Votes each participant may cast in the discuss phase. */
  votesPerPerson: number
  columns: Record<Id, Column>
  notes: Record<Id, Note>
}

export interface Participant {
  id: Id
  name: string
  /** One of a fixed palette; the client picks, the server only relays. */
  color: string
}

export interface Presence extends Participant {
  cursor: { x: number; y: number } | null
  /** Note the person has open for editing, so others get a hint before they collide. */
  editing: Id | null
  /** Server-side: last time this presence was refreshed. */
  seenAt: number
}
