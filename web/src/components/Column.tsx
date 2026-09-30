import type {
  BoardState,
  Column as ColumnModel,
  Id,
  Note,
  Participant,
  Presence,
} from '@tandem/shared'
import { between } from '@tandem/shared'

import { newId } from '../lib/ids.ts'
import type { BoardStore } from '../sync/store.ts'
import type { DragState } from './Board.tsx'
import { EditableText } from './EditableText.tsx'
import { NoteCard } from './NoteCard.tsx'

interface Props {
  column: ColumnModel
  notes: Note[]
  board: BoardState
  me: Participant
  others: Presence[]
  store: BoardStore
  drag: DragState | null
  canDelete: boolean
  votesLeft: number
  beginDrag: (noteId: Id, e: PointerEvent, el: HTMLElement) => void
  moveByKey: (noteId: Id, direction: 'up' | 'down' | 'left' | 'right') => void
  setEditing: (id: Id | null) => void
}

export function Column({
  column,
  notes,
  board,
  me,
  others,
  store,
  drag,
  canDelete,
  votesLeft,
  beginDrag,
  moveByKey,
  setEditing,
}: Props) {
  const addNote = () => {
    const last = notes[notes.length - 1]
    store.dispatch({
      kind: 'note.create',
      id: newId(),
      columnId: column.id,
      text: '',
      color: 'yellow',
      order: between(last?.order, undefined),
    })
  }
  const remove = () => {
    const count = notes.length
    if (
      count > 0 &&
      !confirm(`Delete "${column.title}" and its ${count} note${count === 1 ? '' : 's'}?`)
    )
      return
    store.dispatch({ kind: 'column.delete', id: column.id })
  }
  const dropAt = drag?.target?.columnId === column.id ? drag.target.index : null

  return (
    <section
      data-column-id={column.id}
      aria-label={column.title}
      className="bg-panel/60 border-line flex w-72 shrink-0 flex-col rounded-xl border"
    >
      <header className="flex items-center gap-1 px-3 pt-3 pb-1">
        <EditableText
          value={column.title}
          onCommit={(title) => store.dispatch({ kind: 'column.update', id: column.id, title })}
          className="min-w-0 flex-1 text-sm font-semibold"
          label={`Rename column ${column.title}`}
          maxLength={80}
        />
        <span className="text-muted font-mono text-xs" aria-label={`${notes.length} notes`}>
          {notes.length}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={remove}
            className="text-muted hover:text-danger rounded px-1 text-sm"
            aria-label={`Delete column ${column.title}`}
          >
            ×
          </button>
        )}
      </header>
      <ol className="flex min-h-16 flex-col gap-2 px-3 pb-2" aria-describedby="dnd-help">
        {notes.map((note, i) => (
          <li key={note.id} className="contents">
            {dropAt === i && <DropLine />}
            <NoteCard
              note={note}
              board={board}
              me={me}
              others={others}
              store={store}
              dragging={drag?.noteId === note.id}
              votesLeft={votesLeft}
              beginDrag={beginDrag}
              moveByKey={moveByKey}
              setEditing={setEditing}
            />
          </li>
        ))}
        {dropAt === notes.length && <DropLine />}
      </ol>
      <button
        type="button"
        onClick={addNote}
        className="text-muted hover:text-ink hover:bg-paper mx-3 mb-3 rounded-lg py-2 text-sm"
      >
        + Add note
      </button>
    </section>
  )
}

function DropLine() {
  return <div aria-hidden="true" className="bg-accent h-0.5 rounded" />
}
