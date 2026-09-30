import { useSyncExternalStore } from 'react'

import type { BoardStore, Snapshot } from './store.ts'

export function useBoardStore(store: BoardStore): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
