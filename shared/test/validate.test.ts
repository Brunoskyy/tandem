import { describe, expect, it } from 'vitest'

import { InvalidMessage, parseOp, parseOpBody, parseParticipantName } from '../src/validate.ts'

describe('parseOpBody', () => {
  it('accepts well-formed ops', () => {
    expect(
      parseOpBody({
        kind: 'note.create',
        id: 'n1',
        columnId: 'c1',
        text: 'hi',
        color: 'pink',
        order: 3.5,
      }),
    ).toEqual({
      kind: 'note.create',
      id: 'n1',
      columnId: 'c1',
      text: 'hi',
      color: 'pink',
      order: 3.5,
    })
    expect(parseOpBody({ kind: 'board.update', phase: 'discuss', votesPerPerson: 4 })).toEqual({
      kind: 'board.update',
      phase: 'discuss',
      votesPerPerson: 4,
    })
  })

  it('rejects the ways a client could misbehave', () => {
    const bad = (v: unknown) => expect(() => parseOpBody(v)).toThrow(InvalidMessage)
    bad(null)
    bad({ kind: 'note.explode' })
    bad({ kind: 'note.create', id: '../x', columnId: 'c', text: '', color: 'pink', order: 0 })
    bad({
      kind: 'note.create',
      id: 'n',
      columnId: 'c',
      text: 'x'.repeat(501),
      color: 'pink',
      order: 0,
    })
    bad({ kind: 'note.create', id: 'n', columnId: 'c', text: '', color: 'red', order: 0 })
    bad({ kind: 'note.move', id: 'n', columnId: 'c', order: Number.POSITIVE_INFINITY })
    bad({ kind: 'note.update', id: 'n' })
    bad({ kind: 'vote.set', noteId: 'n', on: 'yes' })
    bad({ kind: 'board.update', votesPerPerson: 2.5 })
    bad({ kind: 'board.update', votesPerPerson: 99 })
    bad({ kind: 'board.update', phase: 'done' })
  })

  it('drops unknown fields so nothing extra reaches the state', () => {
    const body = parseOpBody({ kind: 'note.delete', id: 'n1', admin: true })
    expect(body).toEqual({ kind: 'note.delete', id: 'n1' })
  })
})

describe('parseOp', () => {
  it('pins the actor to the connection, whatever the client claims', () => {
    const op = parseOp(
      { opId: 'o1', actor: 'someone-else', at: 5, body: { kind: 'note.delete', id: 'n1' } },
      'ana',
    )
    expect(op).toEqual({ opId: 'o1', actor: 'ana', at: 5, body: { kind: 'note.delete', id: 'n1' } })
  })

  it('substitutes a bad clock', () => {
    const op = parseOp({ opId: 'o1', at: 'now', body: { kind: 'note.delete', id: 'n1' } }, 'ana')
    expect(typeof op.at).toBe('number')
  })

  it('validates names', () => {
    expect(parseParticipantName('  Ana ')).toBe('Ana')
    expect(() => parseParticipantName('   ')).toThrow(/empty/)
    expect(() => parseParticipantName('x'.repeat(40))).toThrow(/longer/)
  })
})
