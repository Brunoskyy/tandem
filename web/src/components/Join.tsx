import { useState, type FormEvent } from 'react'

import type { Participant } from '@tandem/shared'

import { newIdentity, PEOPLE_COLORS } from '../lib/identity.ts'

export function Join({ onJoin }: { onJoin: (p: Participant) => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(
    () => PEOPLE_COLORS[Math.floor(Math.random() * PEOPLE_COLORS.length)]!,
  )

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onJoin(newIdentity(trimmed.slice(0, 32), color))
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-4 py-12">
      <form onSubmit={submit} className="bg-panel border-line rounded-2xl border p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Who's joining?</h1>
        <p className="text-muted mt-1 text-sm">Your name shows on your notes and your cursor.</p>
        <label className="mt-5 block text-sm font-medium" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          className="border-line bg-paper mt-1.5 w-full rounded-lg border px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          autoFocus
          required
        />
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Color</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PEOPLE_COLORS.map((c) => (
              <label key={c} className="cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={c}
                  checked={color === c}
                  onChange={() => setColor(c)}
                  className="sr-only"
                />
                <span
                  aria-label={`color ${c}`}
                  className={`block h-8 w-8 rounded-full ring-offset-2 ${color === c ? 'ring-ink ring-2' : ''}`}
                  style={{ background: c }}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          className="bg-accent mt-6 w-full rounded-lg px-4 py-2.5 font-medium text-white"
        >
          Join the board
        </button>
      </form>
    </main>
  )
}
