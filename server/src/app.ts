import { createServer, type Server } from 'node:http'

import { createRequestHandler } from './http.ts'
import { Rooms } from './rooms.ts'
import { Store } from './store.ts'
import { attachWebSockets } from './ws.ts'

export interface AppOptions {
  dbPath: string
  staticDir?: string | undefined
  idleMs?: number
  opsPerSecond?: number
}

export interface App {
  server: Server
  rooms: Rooms
  store: Store
  listen(port: number, host?: string): Promise<number>
  close(): Promise<void>
}

export function createApp(options: AppOptions): App {
  const store = new Store(options.dbPath)
  const rooms = new Rooms(store, options.idleMs)
  const server = createServer((req, res) => {
    void createRequestHandler({ rooms, staticDir: options.staticDir })(req, res)
  })
  const wss = attachWebSockets(
    server,
    rooms,
    options.opsPerSecond ? { opsPerSecond: options.opsPerSecond } : {},
  )
  const sweeper = setInterval(() => rooms.sweep(), 60_000)

  return {
    server,
    rooms,
    store,
    listen: (port, host = '0.0.0.0') =>
      new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address()
          resolve(typeof address === 'object' && address ? address.port : port)
        })
      }),
    close: async () => {
      clearInterval(sweeper)
      for (const client of wss.clients) client.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rooms.flushAll()
      store.close()
    },
  }
}
