import type { BoardState, Id, NoteColor, Phase } from './types.ts'

/**
 * Everything that changes a board is one of these. A client applies its own
 * ops immediately and sends them; the server assigns each accepted op a
 * sequence number and broadcasts it. Because every client applies ops in
 * server order, "last writer wins" simply means "the op the server saw last".
 */
export type OpBody =
  | {
      kind: 'note.create'
      id: Id
      columnId: Id
      text: string
      color: NoteColor
      order: number
    }
  | { kind: 'note.update'; id: Id; text?: string; color?: NoteColor }
  | { kind: 'note.move'; id: Id; columnId: Id; order: number }
  | { kind: 'note.delete'; id: Id }
  | { kind: 'vote.set'; noteId: Id; on: boolean }
  | { kind: 'column.create'; id: Id; title: string; order: number }
  | { kind: 'column.update'; id: Id; title?: string; order?: number }
  | { kind: 'column.delete'; id: Id }
  | { kind: 'board.update'; title?: string; phase?: Phase; votesPerPerson?: number }

export interface Op {
  /** Client-generated, unique per board. The server ignores an id it has already applied. */
  opId: Id
  /** Who issued it. Set by the client, verified by the server against the socket's participant. */
  actor: Id
  /** Client wall clock when created; used for `createdAt`/`updatedAt` only, never for ordering. */
  at: number
  body: OpBody
}

export interface SequencedOp {
  seq: number
  op: Op
}

/**
 * Applies one op. Pure, and safe to call with ops that no longer make sense
 * (a note that was deleted, a duplicate create): those become no-ops rather
 * than errors, because with concurrent editors they are the normal case.
 */
/**
 * Records are plain objects keyed by client-chosen ids, so lookups must not
 * fall through to the prototype: `notes['constructor']` is a function, and a
 * truthy one. Every read goes through here.
 */
export function lookup<T>(record: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined
}

export function applyOp(state: BoardState, op: Op): BoardState {
  const b = op.body
  switch (b.kind) {
    case 'note.create': {
      if (lookup(state.notes, b.id) || !lookup(state.columns, b.columnId)) return state
      return {
        ...state,
        notes: {
          ...state.notes,
          [b.id]: {
            id: b.id,
            columnId: b.columnId,
            text: b.text,
            color: b.color,
            order: b.order,
            authorId: op.actor,
            votes: {},
            createdAt: op.at,
            updatedAt: op.at,
          },
        },
      }
    }
    case 'note.update': {
      const note = lookup(state.notes, b.id)
      if (!note) return state
      const next = { ...note, updatedAt: op.at }
      if (b.text !== undefined) next.text = b.text
      if (b.color !== undefined) next.color = b.color
      return { ...state, notes: { ...state.notes, [b.id]: next } }
    }
    case 'note.move': {
      const note = lookup(state.notes, b.id)
      if (!note || !lookup(state.columns, b.columnId)) return state
      return {
        ...state,
        notes: { ...state.notes, [b.id]: { ...note, columnId: b.columnId, order: b.order } },
      }
    }
    case 'note.delete': {
      if (!lookup(state.notes, b.id)) return state
      const { [b.id]: _gone, ...notes } = state.notes
      return { ...state, notes }
    }
    case 'vote.set': {
      const note = lookup(state.notes, b.noteId)
      if (!note) return state
      const has = Object.hasOwn(note.votes, op.actor)
      if (has === b.on) return state
      if (b.on) {
        const used = countVotes(state, op.actor)
        if (used >= state.votesPerPerson) return state
      }
      const { [op.actor]: _mine, ...others } = note.votes
      const votes = b.on ? { ...others, [op.actor]: true as const } : others
      return { ...state, notes: { ...state.notes, [b.noteId]: { ...note, votes } } }
    }
    case 'column.create': {
      if (lookup(state.columns, b.id)) return state
      return {
        ...state,
        columns: { ...state.columns, [b.id]: { id: b.id, title: b.title, order: b.order } },
      }
    }
    case 'column.update': {
      const col = lookup(state.columns, b.id)
      if (!col) return state
      const next = { ...col }
      if (b.title !== undefined) next.title = b.title
      if (b.order !== undefined) next.order = b.order
      return { ...state, columns: { ...state.columns, [b.id]: next } }
    }
    case 'column.delete': {
      if (!lookup(state.columns, b.id)) return state
      if (Object.keys(state.columns).length <= 1) return state
      const { [b.id]: _gone, ...columns } = state.columns
      // Notes go with the column. Moving them elsewhere silently would surprise
      // the person who deleted it more than losing them, and there is undo on the client.
      const notes: BoardState['notes'] = {}
      for (const n of Object.values(state.notes)) if (n.columnId !== b.id) notes[n.id] = n
      return { ...state, columns, notes }
    }
    case 'board.update': {
      const next = { ...state }
      if (b.title !== undefined) next.title = b.title
      if (b.phase !== undefined) next.phase = b.phase
      if (b.votesPerPerson !== undefined) next.votesPerPerson = b.votesPerPerson
      return next
    }
  }
}

export function applyOps(state: BoardState, ops: readonly Op[]): BoardState {
  let s = state
  for (const op of ops) s = applyOp(s, op)
  return s
}

export function countVotes(state: BoardState, participantId: Id): number {
  let n = 0
  for (const note of Object.values(state.notes))
    if (Object.hasOwn(note.votes, participantId)) n += 1
  return n
}

/**
 * What a participant is allowed to see: during the write phase, other
 * people's note text is blank. The server applies this per connection, so
 * the text never reaches a browser that should not have it.
 */
export function visibleTo(state: BoardState, participantId: Id): BoardState {
  if (state.phase !== 'write') return state
  const notes: BoardState['notes'] = {}
  for (const note of Object.values(state.notes)) {
    notes[note.id] = note.authorId === participantId ? note : { ...note, text: '' }
  }
  return { ...state, notes }
}

/** The same rule for a single op on its way to one participant. */
export function opVisibleTo(state: BoardState, op: Op, participantId: Id): Op {
  if (state.phase !== 'write' || op.actor === participantId) return op
  const b = op.body
  if (b.kind === 'note.create' && b.text !== '') return { ...op, body: { ...b, text: '' } }
  if (b.kind === 'note.update' && b.text !== undefined) {
    const { text: _hidden, ...rest } = b
    return { ...op, body: rest }
  }
  return op
}
