import { useState, type FormEvent } from 'react'

import { TEMPLATES } from '@tandem/shared'

import { navigate } from '../lib/router.ts'

export function Home() {
  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState('retro')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, template }),
      })
      if (!res.ok) throw new Error(`The server answered ${res.status}.`)
      const { id } = (await res.json()) as { id: string }
      navigate(`/b/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the board.')
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-4 py-12">
      <header className="mb-10">
        <p className="text-accent mb-3 font-mono text-xs tracking-wider uppercase">Tandem</p>
        <h1 className="text-4xl font-semibold tracking-tight">A board for the whole call.</h1>
        <p className="text-muted mt-3 text-lg">
          Sticky notes, votes and cursors, live for everyone with the link. Write in private, reveal
          together, take the actions home as markdown.
        </p>
      </header>
      <form
        onSubmit={(e) => void submit(e)}
        className="bg-panel border-line rounded-2xl border p-6 shadow-sm"
      >
        <label className="block text-sm font-medium" htmlFor="title">
          Board name
        </label>
        <input
          id="title"
          className="border-line bg-paper mt-1.5 w-full rounded-lg border px-3 py-2"
          placeholder="Sprint 12 retro"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          autoFocus
        />
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Template</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {TEMPLATES.map((t) => (
              <label
                key={t.key}
                className={`border-line cursor-pointer rounded-lg border p-3 text-sm ${
                  template === t.key ? 'border-accent bg-accent-soft' : ''
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  value={t.key}
                  checked={template === t.key}
                  onChange={() => setTemplate(t.key)}
                  className="sr-only"
                />
                <span className="font-medium">{t.name}</span>
                <span className="text-muted mt-0.5 block text-xs">{t.columns.join(' · ')}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-danger mt-4 text-sm">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="bg-accent mt-6 w-full rounded-lg px-4 py-2.5 font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create board'}
        </button>
      </form>
      <p className="text-muted mt-6 text-sm">
        No accounts. Whoever has the link is in. Boards that sit unused are kept, not deleted.
      </p>
    </main>
  )
}
