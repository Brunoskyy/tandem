import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  NOTE_COLORS,
  type BoardState,
  type Id,
  type Note,
  type Participant,
  type Presence,
} from '@tandem/shared'

import type { BoardStore } from '../sync/store.ts'

interface Props {
  note: Note
  board: BoardState
  me: Participant
  others: Presence[]
  store: BoardStore
  dragging: boolean
  votesLeft: number
  beginDrag: (noteId: Id, e: PointerEvent, el: HTMLElement) => void
  moveByKey: (noteId: Id, direction: 'up' | 'down' | 'left' | 'right') => void
  setEditing: (id: Id | null) => void
}

const DRAG_THRESHOLD = 4
const SAVE_DEBOUNCE_MS = 300

export function NoteCard({
  note,
  board,
  me,
  others,
  store,
  dragging,
  votesLeft,
  beginDrag,
  moveByKey,
  setEditing,
}: Props) {
  const mine = note.authorId === me.id
  const hidden = board.phase === 'write' && !mine
  const voteCount = Object.keys(note.votes).length
  const voted = note.votes[me.id] === true
  const editor = others.find((p) => p.editing === note.id)
  const [pickingColor, setPickingColor] = useState(false)
  const card = useRef<HTMLElement>(null)

  // Local draft of the text: typing updates it immediately, the op goes out
  // after a pause, and a remote change that arrives while we're not typing
  // replaces it. While focused, ours wins until we blur.
  const [draft, setDraft] = useState(note.text)
  const focused = useRef(false)
  // Only a draft the person actually typed into is sent. Looking at a note
  // while someone else edits it must not send their old text back.
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!focused.current || !dirty.current) setDraft(note.text)
  }, [note.text])
  const flush = (text: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (dirty.current && text !== note.text)
      store.dispatch({ kind: 'note.update', id: note.id, text })
    dirty.current = false
  }
  const onChange = (text: string) => {
    dirty.current = true
    setDraft(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(text), SAVE_DEBOUNCE_MS)
  }
  // Unmounting while focused (a keyboard move to another column re-parents
  // the card) never fires blur, so the "is editing" hint is cleared here.
  useEffect(() => {
    return () => {
      if (focused.current) setEditing(null)
    }
  }, [setEditing])

  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, hidden])
  // A freshly created empty note of mine gets the caret straight away.
  useEffect(() => {
    if (mine && note.text === '' && Date.now() - note.createdAt < 2000) textarea.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = () => {
    const snapshot = { ...note }
    store.dispatch({ kind: 'note.delete', id: note.id })
    store.toast('Note deleted.', {
      label: 'Undo',
      run: () =>
        store.dispatch({
          kind: 'note.create',
          id: snapshot.id,
          columnId: snapshot.columnId,
          text: snapshot.text,
          color: snapshot.color,
          order: snapshot.order,
        }),
    })
  }

  // Drag starts from the grip strip only, so the textarea keeps its selection behaviour.
  const onGripPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    const el = card.current
    if (!el) return
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
      cleanup()
      beginDrag(note.id, ev, el)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
    // A touch that turns into a scroll cancels instead of releasing.
    window.addEventListener('pointercancel', cleanup)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || hidden) return
    const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }
    const dir = map[e.key]
    if (!dir) return
    e.preventDefault()
    moveByKey(note.id, dir)
  }

  return (
    <article
      ref={card}
      data-note-id={note.id}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={hidden ? 'A note someone else is writing' : `Note: ${note.text || 'empty'}`}
      className={`group relative rounded-lg text-sm shadow-sm transition-opacity ${dragging ? 'opacity-30' : ''}`}
      style={{ background: `var(--color-note-${note.color})` }}
    >
      {hidden ? (
        <div className="h-3" aria-hidden="true" />
      ) : (
        <div
          className="h-3 cursor-grab rounded-t-lg active:cursor-grabbing"
          onPointerDown={onGripPointerDown}
          title="Drag to move"
          aria-hidden="true"
        />
      )}
      {hidden ? (
        <div className="px-3 pb-3" aria-hidden="true">
          <div className="space-y-1.5 opacity-40">
            <div className="bg-ink/40 h-2 w-11/12 rounded" />
            <div className="bg-ink/40 h-2 w-7/12 rounded" />
          </div>
          <p className="text-ink/60 mt-2 text-xs">Hidden until the discussion starts</p>
        </div>
      ) : (
        <>
          <textarea
            ref={textarea}
            className="text-ink placeholder:text-ink/40 w-full resize-none bg-transparent px-3 pb-1 leading-snug outline-none"
            value={draft}
            rows={1}
            maxLength={500}
            placeholder="Type something…"
            aria-label="Note text"
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              focused.current = true
              setEditing(note.id)
            }}
            onBlur={() => {
              focused.current = false
              flush(draft)
              setEditing(null)
            }}
          />
          <footer className="text-ink/70 flex items-center gap-1 px-2 pb-1.5 text-xs">
            {editor && (
              <span
                className="mr-auto flex items-center gap-1 truncate"
                title={`${editor.name} is editing`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: editor.color }} />
                {editor.name} is editing
              </span>
            )}
            {!editor && (
              <span className="mr-auto truncate opacity-70">
                {mine ? 'you' : authorName(note.authorId, others)}
              </span>
            )}
            {board.phase === 'discuss' && (
              <button
                type="button"
                aria-pressed={voted}
                disabled={!voted && votesLeft <= 0}
                onClick={() => store.dispatch({ kind: 'vote.set', noteId: note.id, on: !voted })}
                className={`rounded px-1.5 py-0.5 disabled:opacity-40 ${voted ? 'bg-ink/15 font-semibold' : 'hover:bg-ink/10'}`}
                aria-label={`${voted ? 'Remove your vote' : 'Vote'}, ${voteCount} vote${voteCount === 1 ? '' : 's'}`}
              >
                ▲ {voteCount}
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickingColor((v) => !v)}
                aria-expanded={pickingColor}
                aria-label="Change color"
                className="hover:bg-ink/10 rounded px-1.5 py-0.5"
              >
                ●
              </button>
              {pickingColor && (
                <div
                  role="group"
                  aria-label="Colors"
                  className="bg-panel border-line absolute right-0 z-10 mt-1 flex gap-1 rounded-lg border p-1.5 shadow-lg"
                >
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={note.color === c}
                      onClick={() => {
                        store.dispatch({ kind: 'note.update', id: note.id, color: c })
                        setPickingColor(false)
                      }}
                      className={`h-5 w-5 rounded-full ${note.color === c ? 'ring-ink ring-2 ring-offset-1' : ''}`}
                      style={{ background: `var(--color-note-${c})` }}
                    />
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={remove}
              aria-label="Delete note"
              className="hover:bg-ink/10 rounded px-1.5 py-0.5"
            >
              ×
            </button>
          </footer>
        </>
      )}
    </article>
  )
}

function authorName(id: Id, others: Presence[]): string {
  return others.find((p) => p.id === id)?.name ?? 'someone'
}
