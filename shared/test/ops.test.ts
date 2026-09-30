import { describe, expect, it } from 'vitest'

import { applyOp, applyOps, countVotes, type Op } from '../src/ops.ts'
import { newBoard, TEMPLATES } from '../src/templates.ts'

let n = 0
const mk = () => `id${++n}`
const board = () => newBoard('b1', 'Sprint 12', TEMPLATES[0]!, mk)
const op = (body: Op['body'], actor = 'ana', at = 1000): Op => ({ opId: mk(), actor, at, body })
const firstColumn = (s: ReturnType<typeof board>) => Object.keys(s.columns)[0]!

describe('applyOp', () => {
  it('creates, updates, moves and deletes a note', () => {
    let s = board()
    const col = firstColumn(s)
    s = applyOp(
      s,
      op({
        kind: 'note.create',
        id: 'n1',
        columnId: col,
        text: 'Ship it',
        color: 'yellow',
        order: 0,
      }),
    )
    expect(s.notes.n1).toMatchObject({
      text: 'Ship it',
      authorId: 'ana',
      createdAt: 1000,
      votes: {},
    })

    s = applyOp(s, op({ kind: 'note.update', id: 'n1', text: 'Ship it!' }, 'bea', 2000))
    expect(s.notes.n1).toMatchObject({
      text: 'Ship it!',
      color: 'yellow',
      updatedAt: 2000,
      authorId: 'ana',
    })

    const other = Object.keys(s.columns)[1]!
    s = applyOp(s, op({ kind: 'note.move', id: 'n1', columnId: other, order: 512 }))
    expect(s.notes.n1).toMatchObject({ columnId: other, order: 512 })

    s = applyOp(s, op({ kind: 'note.delete', id: 'n1' }))
    expect(s.notes.n1).toBeUndefined()
  })

  it('treats stale ops as no-ops and returns the same object', () => {
    const s = board()
    const col = firstColumn(s)
    expect(applyOp(s, op({ kind: 'note.update', id: 'ghost', text: 'x' }))).toBe(s)
    expect(applyOp(s, op({ kind: 'note.delete', id: 'ghost' }))).toBe(s)
    expect(applyOp(s, op({ kind: 'note.move', id: 'ghost', columnId: col, order: 0 }))).toBe(s)
    expect(
      applyOp(
        s,
        op({ kind: 'note.create', id: 'n1', columnId: 'nope', text: '', color: 'blue', order: 0 }),
      ),
    ).toBe(s)
    const created = applyOp(
      s,
      op({ kind: 'note.create', id: 'n1', columnId: col, text: 'a', color: 'blue', order: 0 }),
    )
    expect(
      applyOp(
        created,
        op({ kind: 'note.create', id: 'n1', columnId: col, text: 'b', color: 'pink', order: 9 }),
      ),
    ).toBe(created)
  })

  it('server order decides concurrent edits to the same note', () => {
    const s = board()
    const col = firstColumn(s)
    const base = applyOp(
      s,
      op({ kind: 'note.create', id: 'n1', columnId: col, text: '', color: 'blue', order: 0 }),
    )
    const a = op({ kind: 'note.update', id: 'n1', text: 'from ana' }, 'ana', 5000)
    const b = op({ kind: 'note.update', id: 'n1', color: 'pink' }, 'bea', 1000)
    // Different fields both survive; the same field goes to whichever the server saw last.
    expect(applyOps(base, [a, b]).notes.n1).toMatchObject({ text: 'from ana', color: 'pink' })
    const c = op({ kind: 'note.update', id: 'n1', text: 'from bea' }, 'bea', 1)
    expect(applyOps(base, [a, c]).notes.n1?.text).toBe('from bea')
    expect(applyOps(base, [c, a]).notes.n1?.text).toBe('from ana')
  })

  it('votes are a set per participant, capped per person', () => {
    let s = { ...board(), votesPerPerson: 2 }
    const col = firstColumn(s)
    for (const id of ['n1', 'n2', 'n3']) {
      s = applyOp(
        s,
        op({ kind: 'note.create', id, columnId: col, text: id, color: 'green', order: 0 }),
      )
    }
    s = applyOp(s, op({ kind: 'vote.set', noteId: 'n1', on: true }, 'ana'))
    s = applyOp(s, op({ kind: 'vote.set', noteId: 'n1', on: true }, 'ana')) // idempotent
    s = applyOp(s, op({ kind: 'vote.set', noteId: 'n1', on: true }, 'bea'))
    s = applyOp(s, op({ kind: 'vote.set', noteId: 'n2', on: true }, 'ana'))
    s = applyOp(s, op({ kind: 'vote.set', noteId: 'n3', on: true }, 'ana')) // over the cap
    expect(Object.keys(s.notes.n1!.votes).sort()).toEqual(['ana', 'bea'])
    expect(countVotes(s, 'ana')).toBe(2)
    expect(s.notes.n3!.votes).toEqual({})

    s = applyOp(s, op({ kind: 'vote.set', noteId: 'n1', on: false }, 'ana'))
    expect(s.notes.n1!.votes).toEqual({ bea: true })
    s = applyOp(s, op({ kind: 'vote.set', noteId: 'n3', on: true }, 'ana'))
    expect(s.notes.n3!.votes).toEqual({ ana: true })
  })

  it('deleting a column takes its notes and never the last column', () => {
    let s = board()
    const [c1, c2, c3] = Object.keys(s.columns)
    s = applyOp(
      s,
      op({ kind: 'note.create', id: 'n1', columnId: c1!, text: '', color: 'blue', order: 0 }),
    )
    s = applyOp(
      s,
      op({ kind: 'note.create', id: 'n2', columnId: c2!, text: '', color: 'blue', order: 0 }),
    )
    s = applyOp(s, op({ kind: 'column.delete', id: c1! }))
    expect(Object.keys(s.notes)).toEqual(['n2'])
    s = applyOp(s, op({ kind: 'column.delete', id: c2! }))
    const last = applyOp(s, op({ kind: 'column.delete', id: c3! }))
    expect(last).toBe(s)
    expect(Object.keys(last.columns)).toEqual([c3])
  })

  it('updates board fields independently', () => {
    let s = board()
    s = applyOp(s, op({ kind: 'board.update', phase: 'discuss' }))
    s = applyOp(s, op({ kind: 'board.update', title: 'Sprint 13', votesPerPerson: 5 }))
    expect(s).toMatchObject({ phase: 'discuss', title: 'Sprint 13', votesPerPerson: 5 })
  })
})
