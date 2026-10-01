import { newBoard, TEMPLATES, type BoardState, type Note, type OpBody } from '@tandem/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Board } from '../src/components/Board.tsx'
import type { BoardStore, Snapshot } from '../src/sync/store.ts'

let n = 0
const me = { id: 'ana', name: 'Ana', color: '#000' }

const note = (id: string, columnId: string, order: number, authorId = 'ana'): Note => ({
  id,
  columnId,
  order,
  text: id,
  color: 'yellow',
  authorId,
  votes: {},
  createdAt: 0,
  updatedAt: 0,
})

function setup() {
  const base = newBoard('b1', 'Retro', TEMPLATES[0]!, () => `c${++n}`)
  const [c1, c2] = Object.keys(base.columns) as [string, string]
  const board: BoardState = { ...base, phase: 'discuss', notes: { a: note('a', c1, 0) } }
  const dispatched: OpBody[] = []
  const store = {
    dispatch: vi.fn((body: OpBody) => {
      dispatched.push(body)
      return { opId: 'x', actor: 'ana', at: 0, body }
    }),
    presence: vi.fn(),
    toast: vi.fn(),
    dismissToast: vi.fn(),
  } as unknown as BoardStore
  const snapshot: Snapshot = {
    board,
    status: 'online',
    me,
    others: [],
    pendingCount: 0,
    toasts: [],
    fatal: null,
  }
  const view = render(<Board store={store} snapshot={snapshot} board={board} />)
  const rerender = (next: BoardState) =>
    view.rerender(<Board store={store} snapshot={{ ...snapshot, board: next }} board={next} />)
  return { board, c2, dispatched, rerender }
}

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint')
})

describe('Board', () => {
  it('computes a drop from the notes as they are at drop time', () => {
    const { board, c2, dispatched, rerender } = setup()
    const grip = screen.getAllByTitle('Drag to move')[0]!
    fireEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })

    // While the card is in the air, someone else adds a note to the target column.
    rerender({ ...board, notes: { ...board.notes, x: note('x', c2, 0, 'bea') } })

    // jsdom has no layout: every card's midpoint is 0, so the pointer is below x.
    const column = document.querySelector<HTMLElement>(`[data-column-id="${c2}"]`)!
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => column,
    })
    fireEvent.pointerMove(window, { clientX: 30, clientY: 30 })
    fireEvent.pointerUp(window)

    // After x, not at the top of what was an empty column when the drag began.
    expect(dispatched).toEqual([{ kind: 'note.move', id: 'a', columnId: c2, order: 1024 }])
  })
})
