import { useSyncExternalStore } from 'react'

/**
 * Two routes do not justify a router. `/` is the lobby, `/b/<id>` is a board.
 */
export type Route = { name: 'home' } | { name: 'board'; id: string }

function parse(pathname: string): Route {
  const m = /^\/b\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)
  return m && m[1] ? { name: 'board', id: m[1] } : { name: 'home' }
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}
if (typeof window !== 'undefined') window.addEventListener('popstate', emit)

export function navigate(path: string): void {
  history.pushState(null, '', path)
  emit()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => '/',
  )
  return parse(pathname)
}
