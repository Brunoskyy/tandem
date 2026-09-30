import type { ClientMessage, ServerMessage } from '@tandem/shared'

/**
 * A WebSocket stand-in the test drives by hand: `open()`, `receive()`, `drop()`.
 * Everything the client sends is kept in `sent`.
 */
export class FakeSocket {
  static instances: FakeSocket[] = []
  readonly sent: ClientMessage[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null

  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage)
  }

  close(): void {
    this.drop(1000)
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  receive(m: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(m) })
  }

  drop(code = 1006): void {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

export const factory = (url: string) => new FakeSocket(url) as unknown as WebSocket
