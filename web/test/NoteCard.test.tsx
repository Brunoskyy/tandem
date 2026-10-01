import { newBoard, TEMPLATES, type Note, type OpBody } from '@tandem/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NoteCard } from '../src/components/NoteCard.tsx'
import type { BoardStore } from '../src/sync/store.ts'

let n = 0
const board = () => newBoard('b1', 'Retro', TEMPLATES[0]!, () => `c${++n}`)
const me = { id: 'ana', name: 'Ana', color: '#000' }
const bea = { id: 'bea', name: 'Bea', color: '#111', cursor: null, editing: null }

function setup(
  overrides: Partial<Note> = {},
  boardOverrides: Partial<ReturnType<typeof board>> = {},
) {
  const b = { ...board(), ...boardOverrides }
  const note: Note = {
    id: 'n1',
    columnId: Object.keys(b.columns)[0]!,
    text: 'Hello',
    color: 'yellow',
    order: 0,
    authorId: 'ana',
    votes: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
  const dispatched: OpBody[] = []
  const store = {
    dispatch: vi.fn((body: OpBody) => {
      dispatched.push(body)
      return { opId: 'x', actor: 'ana', at: 0, body }
    }),
    toast: vi.fn(),
  } as unknown as BoardStore
  const setEditing = vi.fn()
  render(
    <NoteCard
      note={note}
      board={b}
      me={me}
      others={[bea]}
      store={store}
      dragging={false}
      votesLeft={3}
      beginDrag={vi.fn()}
      moveByKey={vi.fn()}
      setEditing={setEditing}
    />,
  )
  return { dispatched, store, setEditing }
}

describe('NoteCard', () => {
  it('hides other people’s notes while writing and shows them while discussing', () => {
    setup({ authorId: 'bea' })
    expect(screen.getByText('Hidden until the discussion starts')).toBeInTheDocument()
    expect(screen.queryByLabelText('Note text')).toBeNull()
  })

  it('shows the text and voting once the phase is discuss', () => {
    setup({ authorId: 'bea', votes: { bea: true } }, { phase: 'discuss' })
    expect(screen.getByLabelText('Note text')).toHaveValue('Hello')
    expect(screen.getByRole('button', { name: /Vote, 1 vote/ })).toBeInTheDocument()
  })

  it('sends one update after typing settles, and flushes on blur', async () => {
    const user = userEvent.setup()
    const { dispatched, setEditing } = setup()
    const ta = screen.getByLabelText('Note text')
    await user.click(ta)
    expect(setEditing).toHaveBeenCalledWith('n1')
    await user.type(ta, ' world')
    expect(dispatched).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 400))
    expect(dispatched).toEqual([{ kind: 'note.update', id: 'n1', text: 'Hello world' }])
    await user.type(ta, '!')
    await user.tab()
    expect(dispatched[1]).toEqual({ kind: 'note.update', id: 'n1', text: 'Hello world!' })
    expect(setEditing).toHaveBeenLastCalledWith(null)
  })

  it('toggles a vote and offers undo after delete', async () => {
    const user = userEvent.setup()
    const { dispatched, store } = setup({}, { phase: 'discuss' })
    await user.click(screen.getByRole('button', { name: /Vote, 0 votes/ }))
    expect(dispatched[0]).toEqual({ kind: 'vote.set', noteId: 'n1', on: true })
    await user.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(dispatched[1]).toEqual({ kind: 'note.delete', id: 'n1' })
    const toast = (store.toast as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { run: () => void },
    ]
    toast[1].run()
    expect(dispatched[2]).toMatchObject({ kind: 'note.create', id: 'n1', text: 'Hello' })
  })

  it('does not send stale text when leaving a note it only looked at', async () => {
    const user = userEvent.setup()
    const { dispatched } = setup({}, { phase: 'discuss' })
    await user.click(screen.getByLabelText('Note text'))
    await user.tab()
    expect(dispatched).toEqual([])
  })

  it('gives hidden notes no drag handle', () => {
    setup({ authorId: 'bea' })
    expect(screen.queryByTitle('Drag to move')).toBeNull()
  })

  it('says who else is editing', () => {
    setup({}, { phase: 'discuss' })
    expect(screen.getByText('you')).toBeInTheDocument()
  })
})
