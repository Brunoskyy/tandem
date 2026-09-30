import type { Note } from '@tandem/shared'
import { describe, expect, it } from 'vitest'

import { dropIndex, moveOps } from '../src/lib/dnd.ts'

const note = (id: string, columnId: string, order: number): Note => ({
  id,
  columnId,
  order,
  text: id,
  color: 'yellow',
  authorId: 'ana',
  votes: {},
  createdAt: 0,
  updatedAt: 0,
})

describe('dropIndex', () => {
  it('counts the midpoints above the pointer', () => {
    expect(dropIndex([], 50)).toBe(0)
    expect(dropIndex([100, 200, 300], 50)).toBe(0)
    expect(dropIndex([100, 200, 300], 150)).toBe(1)
    expect(dropIndex([100, 200, 300], 999)).toBe(3)
  })
})

describe('moveOps', () => {
  const notes = [
    note('a', 'c1', 0),
    note('b', 'c1', 1024),
    note('c', 'c1', 2048),
    note('d', 'c2', 0),
  ]

  it('moves between neighbours with one op', () => {
    expect(moveOps(notes, 'c', 'c1', 1)).toEqual([
      { kind: 'note.move', id: 'c', columnId: 'c1', order: 512 },
    ])
    expect(moveOps(notes, 'a', 'c1', 2)).toEqual([
      { kind: 'note.move', id: 'a', columnId: 'c1', order: 3072 },
    ])
    expect(moveOps(notes, 'd', 'c1', 0)).toEqual([
      { kind: 'note.move', id: 'd', columnId: 'c1', order: -1024 },
    ])
  })

  it('ignores the moving note when computing neighbours', () => {
    // Moving b to index 1 of its own column: neighbours are a and c, not b itself.
    expect(moveOps(notes, 'b', 'c1', 1)).toEqual([
      { kind: 'note.move', id: 'b', columnId: 'c1', order: 1024 },
    ])
  })

  it('spreads the column out when the gap is exhausted', () => {
    const tight = [note('a', 'c1', 0), note('b', 'c1', 1e-9), note('x', 'c2', 0)]
    const ops = moveOps(tight, 'x', 'c1', 1)
    expect(ops.map((o) => (o.kind === 'note.move' ? [o.id, o.order] : null))).toEqual([
      ['a', 0],
      ['b', 2048],
      ['x', 1024],
    ])
  })
})
