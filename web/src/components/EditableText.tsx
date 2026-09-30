import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

interface Props {
  value: string
  onCommit: (value: string) => void
  className?: string
  label: string
  maxLength: number
}

/** A heading that turns into an input on click, commits on Enter or blur, and gives up on Escape. */
export function EditableText({ value, onCommit, className = '', label, maxLength }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) onCommit(next)
    else setDraft(value)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={input}
        aria-label={label}
        className={`bg-paper border-line rounded-md border px-2 py-0.5 ${className}`}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
      />
    )
  }
  return (
    <button
      type="button"
      className={`hover:bg-paper truncate rounded-md px-2 py-0.5 text-left ${className}`}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      title="Click to rename"
    >
      {value}
    </button>
  )
}
