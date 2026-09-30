import { useState } from 'react'

import type { Participant } from '@tandem/shared'

import { BoardPage } from './components/BoardPage.tsx'
import { Home } from './components/Home.tsx'
import { Join } from './components/Join.tsx'
import { loadIdentity, saveIdentity } from './lib/identity.ts'
import { useRoute } from './lib/router.ts'

export function App() {
  const route = useRoute()
  const [identity, setIdentity] = useState<Participant | null>(() => loadIdentity())

  if (route.name === 'home') return <Home />
  if (!identity) {
    return (
      <Join
        onJoin={(p) => {
          saveIdentity(p)
          setIdentity(p)
        }}
      />
    )
  }
  return <BoardPage key={route.id} boardId={route.id} me={identity} />
}
