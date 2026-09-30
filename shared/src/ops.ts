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
export function applyOp(state: BoardState, op: Op): BoardState {
  const b = op.body
  switch (b.kind) {
    case 'note.create': {
      if (state.notes[b.id] || !state.columns[b.columnId]) return state
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
      const note = state.notes[b.id]
      if (!note) return state
      const next = { ...note, updatedAt: op.at }
      if (b.text !== undefined) next.text = b.text
      if (b.color !== undefined) next.color = b.color
      return { ...state, notes: { ...state.notes, [b.id]: next } }
    }
    case 'note.move': {
      const note = state.notes[b.id]
      if (!note || !state.columns[b.columnId]) return state
      return {
        ...state,
        notes: { ...state.notes, [b.id]: { ...note, columnId: b.columnId, order: b.order } },
      }
    }
    case 'note.delete': {
      if (!state.notes[b.id]) return state
      const { [b.id]: _gone, ...notes } = state.notes
      return { ...state, notes }
    }
    case 'vote.set': {
      const note = state.notes[b.noteId]
      if (!note) return state
      const has = note.votes[op.actor] === true
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
      if (state.columns[b.id]) return state
      return {
        ...state,
        columns: { ...state.columns, [b.id]: { id: b.id, title: b.title, order: b.order } },
      }
    }
    case 'column.update': {
      const col = state.columns[b.id]
      if (!col) return state
      const next = { ...col }
      if (b.title !== undefined) next.title = b.title
      if (b.order !== undefined) next.order = b.order
      return { ...state, columns: { ...state.columns, [b.id]: next } }
    }
    case 'column.delete': {
      if (!state.columns[b.id]) return state
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
  for (const note of Object.values(state.notes)) if (note.votes[participantId]) n += 1
  return n
}
