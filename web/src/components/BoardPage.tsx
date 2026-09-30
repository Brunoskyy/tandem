import { useEffect, useMemo } from 'react'

import type { Participant } from '@tandem/shared'

import { BoardStore } from '../sync/store.ts'
import { useBoardStore } from '../sync/useStore.ts'
import { Board } from './Board.tsx'

export function BoardPage({ boardId, me }: { boardId: string; me: Participant }) {
  const store = useMemo(() => new BoardStore(boardId, me), [boardId, me])
  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])
  const snapshot = useBoardStore(store)

  if (snapshot.fatal) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Board not found</h1>
        <p className="text-muted mt-2">{snapshot.fatal}</p>
        <a href="/" className="text-accent mt-6 inline-block underline">
          Start a new one
        </a>
      </main>
    )
  }
  if (!snapshot.board) {
    return (
      <main className="text-muted flex min-h-full items-center justify-center" aria-busy="true">
        {snapshot.status === 'offline' ? 'Trying to reach the server…' : 'Loading the board…'}
      </main>
    )
  }
  return <Board store={store} snapshot={snapshot} board={snapshot.board} />
}
