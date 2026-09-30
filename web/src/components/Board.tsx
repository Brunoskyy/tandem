import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { countVotes, sortByOrder, type BoardState, type Id } from '@tandem/shared'

import { dropIndex, moveOps } from '../lib/dnd.ts'
import { newId } from '../lib/ids.ts'
import type { BoardStore, Snapshot } from '../sync/store.ts'
import { Column } from './Column.tsx'
import { Cursors } from './Cursors.tsx'
import { EditableText } from './EditableText.tsx'
import { Presence } from './Presence.tsx'
import { Toasts } from './Toasts.tsx'

export interface DragState {
  noteId: Id
  x: number
  y: number
  /** Where it would land right now. */
  target: { columnId: Id; index: number } | null
  width: number
  offsetX: number
  offsetY: number
}

interface Props {
  store: BoardStore
  snapshot: Snapshot
  board: BoardState
}

export function Board({ store, snapshot, board }: Props) {
  const columns = sortByOrder(Object.values(board.columns))
  const notes = Object.values(board.notes)
  const me = snapshot.me
  const votesLeft = board.votesPerPerson - countVotes(board, me.id)
  const canvas = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const currentEditing = useRef<Id | null>(null)

  // Cursor presence, in canvas coordinates so it survives everyone's scrolling.
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = canvas.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      store.presence(
        { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop },
        currentEditing.current,
      )
    },
    [store],
  )
  const setEditing = useCallback(
    (id: Id | null) => {
      currentEditing.current = id
      store.presence(null, id)
    },
    [store],
  )

  // Drag and drop with pointer events. The card that starts the drag calls
  // `beginDrag`; the canvas tracks the pointer, computes the target from the
  // DOM (which column is under the pointer, which cards' midpoints are above
  // it) and dispatches the move on release.
  const beginDrag = useCallback((noteId: Id, e: PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const state: DragState = {
      noteId,
      x: e.clientX,
      y: e.clientY,
      target: null,
      width: rect.width,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    }
    dragRef.current = state
    setDrag(state)
  }, [])

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const under = document.elementFromPoint(e.clientX, e.clientY)
      const columnEl = under?.closest<HTMLElement>('[data-column-id]')
      let target: DragState['target'] = null
      if (columnEl) {
        const columnId = columnEl.dataset.columnId as Id
        const cards = [...columnEl.querySelectorAll<HTMLElement>('[data-note-id]')].filter(
          (c) => c.dataset.noteId !== current.noteId,
        )
        const mids = cards.map((c) => {
          const r = c.getBoundingClientRect()
          return r.top + r.height / 2
        })
        target = { columnId, index: dropIndex(mids, e.clientY) }
      }
      const next = { ...current, x: e.clientX, y: e.clientY, target }
      dragRef.current = next
      setDrag(next)
    }
    const up = () => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current?.target) return
      for (const body of moveOps(
        notes,
        current.noteId,
        current.target.columnId,
        current.target.index,
      )) {
        store.dispatch(body)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // notes is read on drop only; re-subscribing on every keystroke would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, store])

  /** Keyboard alternative to dragging: Alt + arrows moves a card. */
  const moveByKey = useCallback(
    (noteId: Id, direction: 'up' | 'down' | 'left' | 'right') => {
      const note = board.notes[noteId]
      if (!note) return
      const inColumn = sortByOrder(notes.filter((n) => n.columnId === note.columnId))
      const at = inColumn.findIndex((n) => n.id === noteId)
      let columnId = note.columnId
      let index = at
      if (direction === 'up') index = Math.max(0, at - 1)
      if (direction === 'down') index = Math.min(inColumn.length - 1, at + 1)
      if (direction === 'left' || direction === 'right') {
        const ci = columns.findIndex((c) => c.id === note.columnId)
        const targetColumn = columns[direction === 'left' ? ci - 1 : ci + 1]
        if (!targetColumn) return
        columnId = targetColumn.id
        index = notes.filter((n) => n.columnId === columnId).length
      }
      if (columnId === note.columnId && index === at) return
      for (const body of moveOps(notes, noteId, columnId, index)) store.dispatch(body)
    },
    [board.notes, columns, notes, store],
  )

  const addColumn = () => {
    const last = columns[columns.length - 1]
    store.dispatch({
      kind: 'column.create',
      id: newId(),
      title: 'New column',
      order: (last?.order ?? 0) + 1024,
    })
  }

  const draggedNote = drag ? board.notes[drag.noteId] : undefined

  return (
    <div className="flex h-full flex-col">
      <header className="border-line bg-panel flex flex-wrap items-center gap-x-4 gap-y-2 overflow-x-clip border-b px-4 py-2.5">
        <a
          href="/"
          className="text-accent font-mono text-xs tracking-wider uppercase"
          aria-label="Tandem home"
        >
          Tandem
        </a>
        <EditableText
          value={board.title}
          onCommit={(title) => store.dispatch({ kind: 'board.update', title })}
          className="min-w-0 text-lg font-semibold tracking-tight"
          label="Board name"
          maxLength={80}
        />
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            role="group"
            aria-label="Phase"
            className="border-line flex rounded-lg border p-0.5 text-sm"
          >
            {(['write', 'discuss'] as const).map((phase) => (
              <button
                key={phase}
                type="button"
                aria-pressed={board.phase === phase}
                onClick={() => store.dispatch({ kind: 'board.update', phase })}
                className={`rounded-md px-3 py-1 ${board.phase === phase ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}
              >
                {phase === 'write' ? 'Writing' : 'Discussing'}
              </button>
            ))}
          </div>
          {board.phase === 'discuss' && (
            <span className="text-muted text-sm whitespace-nowrap" aria-live="polite">
              {votesLeft} of {board.votesPerPerson} votes left
            </span>
          )}
          <a
            href={`/api/boards/${board.id}/export`}
            className="border-line hover:bg-paper rounded-lg border px-3 py-1 text-sm"
            download
          >
            Export
          </a>
          <button
            type="button"
            className="border-line hover:bg-paper rounded-lg border px-3 py-1 text-sm"
            onClick={() => {
              void navigator.clipboard.writeText(location.href).then(
                () => store.toast('Link copied. Anyone with it can join.'),
                () => store.toast(`Copy this link: ${location.href}`),
              )
            }}
          >
            Share
          </button>
          <Presence
            me={me}
            others={snapshot.others}
            status={snapshot.status}
            pending={snapshot.pendingCount}
          />
        </div>
      </header>

      <p className="sr-only" id="dnd-help">
        Drag a card by its top edge, or focus it and press Alt with an arrow key to move it.
      </p>

      <div
        ref={canvas}
        className="relative flex-1 overflow-auto"
        onPointerMove={onPointerMove}
        onPointerLeave={() => store.presence(null, currentEditing.current)}
      >
        <div className="relative flex min-h-full items-start gap-4 p-4">
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              notes={sortByOrder(notes.filter((n) => n.columnId === column.id))}
              board={board}
              me={me}
              others={snapshot.others}
              store={store}
              drag={drag}
              canDelete={columns.length > 1}
              beginDrag={beginDrag}
              moveByKey={moveByKey}
              setEditing={setEditing}
              votesLeft={votesLeft}
            />
          ))}
          <button
            type="button"
            onClick={addColumn}
            className="text-muted hover:text-ink border-line hover:border-muted w-64 shrink-0 rounded-xl border border-dashed py-6 text-sm"
          >
            + Add column
          </button>
          <Cursors others={snapshot.others} />
        </div>
      </div>

      {drag && draggedNote && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed top-0 left-0 z-50 rotate-2 rounded-lg p-3 text-sm shadow-xl"
          style={{
            width: drag.width,
            transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`,
            background: `var(--color-note-${draggedNote.color})`,
          }}
        >
          {draggedNote.text || <span className="opacity-50">Empty note</span>}
        </div>
      )}

      <Toasts toasts={snapshot.toasts} dismiss={(id) => store.dismissToast(id)} />
    </div>
  )
}
