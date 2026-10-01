import type { ClientMessage, Participant, ServerMessage } from '@tandem/shared'

export type Status = 'connecting' | 'online' | 'offline'

export interface ConnectionOptions {
  url: string
  boardId: string
  participant: Participant
  onMessage: (m: ServerMessage) => void
  onStatus: (s: Status) => void
  /** Injectable for tests. */
  socketFactory?: (url: string) => WebSocket
}

/**
 * A WebSocket that reconnects. Backoff doubles from half a second to ten,
 * every open sends a fresh join, and the caller finds out about each status
 * change so the UI can say "reconnecting" instead of silently dropping edits.
 */
export class Connection {
  private ws: WebSocket | null = null
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  status: Status = 'connecting'
  private readonly options: ConnectionOptions

  constructor(options: ConnectionOptions) {
    this.options = options
  }

  start(): void {
    this.closed = false
    this.open()
  }

  stop(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }

  send(message: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
      return true
    }
    return false
  }

  private setStatus(s: Status) {
    if (this.status === s) return
    this.status = s
    this.options.onStatus(s)
  }

  private open() {
    if (this.closed) return
    this.setStatus(this.attempt === 0 ? 'connecting' : 'offline')
    const ws = (this.options.socketFactory ?? ((u) => new WebSocket(u)))(this.options.url)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      ws.send(
        JSON.stringify({
          t: 'join',
          boardId: this.options.boardId,
          participant: this.options.participant,
        } satisfies ClientMessage),
      )
    }
    ws.onmessage = (event: MessageEvent<string>) => {
      let m: ServerMessage
      try {
        m = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      if (m.t === 'welcome') this.setStatus('online')
      this.options.onMessage(m)
    }
    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return
      this.ws = null
      this.setStatus('offline')
      // 4004 is the server saying the board does not exist; retrying will not help.
      if (this.closed || event.code === 4004) return
      const delay = Math.min(10_000, 500 * 2 ** this.attempt)
      this.attempt += 1
      this.timer = setTimeout(() => this.open(), delay)
    }
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    }
  }
}
