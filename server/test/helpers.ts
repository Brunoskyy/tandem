import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClientMessage, ServerMessage } from '@tandem/shared'
import WebSocket from 'ws'

import { createApp, type App } from '../src/app.ts'

export interface TestApp {
  app: App
  port: number
  dir: string
  dbPath: string
  close(): Promise<void>
}

export async function startApp(dbPath?: string, opsPerSecond?: number): Promise<TestApp> {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-'))
  const path = dbPath ?? join(dir, 'test.db')
  const app = createApp({ dbPath: path, idleMs: 50, ...(opsPerSecond ? { opsPerSecond } : {}) })
  const port = await app.listen(0, '127.0.0.1')
  return {
    app,
    port,
    dir,
    dbPath: path,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export async function createBoard(
  t: TestApp,
  title = 'Sprint 12',
  template = 'retro',
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${t.port}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, template }),
  })
  const body = (await res.json()) as { id: string }
  return body.id
}

/** A thin client that records every server message and lets tests await specific ones. */
export class Client {
  readonly messages: ServerMessage[] = []
  private readonly ws: WebSocket
  private waiters: Array<{
    test: (m: ServerMessage) => boolean
    resolve: (m: ServerMessage) => void
  }> = []

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    this.ws.on('message', (data) => {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data as ArrayBuffer).toString('utf8')
      const m = JSON.parse(text) as ServerMessage
      this.messages.push(m)
      this.waiters = this.waiters.filter((w) => {
        if (!w.test(m)) return true
        w.resolve(m)
        return false
      })
    })
  }

  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve())
      this.ws.once('error', reject)
    })
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message))
  }

  /** Resolves with the next message (already received or future) matching `test`. */
  next<T extends ServerMessage['t']>(
    t: T,
    extra?: (m: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const test = (m: ServerMessage) =>
      m.t === t && (!extra || extra(m as Extract<ServerMessage, { t: T }>))
    const seen = this.messages.find(test)
    if (seen) return Promise.resolve(seen as Extract<ServerMessage, { t: T }>)
    return new Promise((resolve) =>
      this.waiters.push({ test, resolve: (m) => resolve(m as Extract<ServerMessage, { t: T }>) }),
    )
  }

  async join(boardId: string, name: string, id = name.toLowerCase(), sinceSeq = 0) {
    await this.open()
    this.send({ t: 'join', boardId, participant: { id, name, color: 'teal' }, sinceSeq })
    return this.next('welcome')
  }

  close(): void {
    this.ws.close()
  }

  closed(): Promise<{ code: number }> {
    return new Promise((resolve) => this.ws.once('close', (code) => resolve({ code })))
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
