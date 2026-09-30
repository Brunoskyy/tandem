import {
  applyOp,
  applyOps,
  type BoardState,
  type Id,
  type Op,
  type OpBody,
  type Participant,
  type Presence,
  type ServerMessage,
} from '@tandem/shared'

import { newId } from '../lib/ids.ts'
import { Connection, type Status } from './connection.ts'

export interface Toast {
  id: number
  text: string
  /** Optional action, e.g. undo. */
  action?: { label: string; run: () => void }
}

export interface Snapshot {
  /** What the server confirmed, with our unconfirmed ops applied on top. */
  board: BoardState | null
  status: Status
  me: Participant
  others: Presence[]
  pendingCount: number
  toasts: Toast[]
  /** Set when the server closed the board for good (not found). */
  fatal: string | null
}

const PENDING_KEY = (boardId: string) => `tandem.pending.${boardId}`
const RESEND_BATCH = 20
const RESEND_INTERVAL_MS = 600

/**
 * The client's copy of a board. Two layers: `confirmed` is exactly what the
 * server has sent, in order; `pending` is what we changed and have not heard
 * back about. The view is always `pending` replayed over `confirmed`, so an
 * edit shows up instantly, survives a reconnect, and lands in the same place
 * everyone else sees once the server orders it.
 */
export class BoardStore {
  private confirmed: BoardState | null = null
  private seq = 0
  private pending: Op[] = []
  private others: Presence[] = []
  private status: Status = 'connecting'
  private toasts: Toast[] = []
  private fatal: string | null = null
  private snapshot: Snapshot
  private readonly listeners = new Set<() => void>()
  private readonly connection: Connection
  private toastSeq = 0
  private resendTimer: ReturnType<typeof setTimeout> | null = null
  private presenceTimer: ReturnType<typeof setTimeout> | null = null
  private lastPresence: { cursor: { x: number; y: number } | null; editing: Id | null } = {
    cursor: null,
    editing: null,
  }

  readonly boardId: string
  readonly me: Participant

  constructor(
    boardId: string,
    me: Participant,
    options: { url?: string; socketFactory?: (url: string) => WebSocket } = {},
  ) {
    this.boardId = boardId
    this.me = me
    this.pending = this.loadPending()
    this.snapshot = this.compute()
    const url =
      options.url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    this.connection = new Connection({
      url,
      boardId,
      participant: me,
      sinceSeq: () => this.seq,
      onMessage: (m) => this.receive(m),
      onStatus: (s) => {
        this.status = s
        this.emit()
      },
      ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
    })
  }

  start(): void {
    this.connection.start()
  }

  stop(): void {
    this.connection.stop()
    if (this.presenceTimer) clearTimeout(this.presenceTimer)
    if (this.resendTimer) clearTimeout(this.resendTimer)
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  getSnapshot = (): Snapshot => this.snapshot

  /** Applies a change locally and sends it. Returns the op so callers can offer undo. */
  dispatch(body: OpBody): Op {
    const op: Op = { opId: newId(), actor: this.me.id, at: Date.now(), body }
    this.pending.push(op)
    this.savePending()
    this.connection.send({ t: 'op', op })
    this.emit()
    return op
  }

  /** Throttled presence: at most one message per 50ms, last value wins. */
  presence(cursor: { x: number; y: number } | null, editing: Id | null): void {
    this.lastPresence = { cursor, editing }
    if (this.presenceTimer) return
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null
      this.connection.send({ t: 'presence', ...this.lastPresence })
    }, 50)
  }

  toast(text: string, action?: Toast['action']): void {
    const id = ++this.toastSeq
    this.toasts = [...this.toasts, action ? { id, text, action } : { id, text }]
    this.emit()
    setTimeout(() => this.dismissToast(id), 6000)
  }

  dismissToast(id: number): void {
    if (!this.toasts.some((t) => t.id === id)) return
    this.toasts = this.toasts.filter((t) => t.id !== id)
    this.emit()
  }

  private receive(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome': {
        this.confirmed = m.state
        this.seq = m.seq
        this.others = m.participants.filter((p) => p.id !== this.me.id)
        // Anything still pending was never acknowledged (or we never heard it
        // was): send it again. The server answers `known` for op ids it has
        // already applied, and the resend is paced under the rate limit.
        this.resendPending()
        break
      }
      case 'known': {
        this.dropPending(m.opId)
        break
      }
      case 'ops': {
        if (!this.confirmed) return
        for (const { seq, op } of m.ops) {
          if (seq <= this.seq) continue
          this.confirmed = applyOp(this.confirmed, op)
          this.seq = seq
          const i = this.pending.findIndex((p) => p.opId === op.opId)
          if (i !== -1) this.pending.splice(i, 1)
        }
        this.savePending()
        break
      }
      case 'presence':
        this.others = m.participants.filter((p) => p.id !== this.me.id)
        break
      case 'rejected': {
        if (m.code === 'rate-limit') {
          // Not a verdict on the op, only on the pace. Keep it and try again.
          this.scheduleResend(1100)
          break
        }
        if (this.dropPending(m.opId)) this.toast(`A change was not accepted: ${m.reason}`)
        break
      }
      case 'error':
        if (m.reason === 'board not found')
          this.fatal = 'This board does not exist, or the link is wrong.'
        else this.toast(m.reason)
        break
      case 'pong':
        break
    }
    this.emit()
  }

  private dropPending(opId: Id): boolean {
    const i = this.pending.findIndex((p) => p.opId === opId)
    if (i === -1) return false
    this.pending.splice(i, 1)
    this.savePending()
    return true
  }

  /** Sends pending ops in small batches so a long offline queue does not trip the server's limit. */
  private resendPending(offset = 0): void {
    const batch = this.pending.slice(offset, offset + RESEND_BATCH)
    for (const op of batch) this.connection.send({ t: 'op', op })
    if (offset + RESEND_BATCH < this.pending.length) {
      this.resendTimer = setTimeout(
        () => this.resendPending(offset + RESEND_BATCH),
        RESEND_INTERVAL_MS,
      )
    } else {
      this.resendTimer = null
    }
  }

  private scheduleResend(ms: number): void {
    if (this.resendTimer) return
    this.resendTimer = setTimeout(() => {
      this.resendTimer = null
      this.resendPending()
    }, ms)
  }

  private compute(): Snapshot {
    return {
      board: this.confirmed ? applyOps(this.confirmed, this.pending) : null,
      status: this.status,
      me: this.me,
      others: this.others,
      pendingCount: this.pending.length,
      toasts: this.toasts,
      fatal: this.fatal,
    }
  }

  private emit(): void {
    this.snapshot = this.compute()
    for (const l of this.listeners) l()
  }

  private loadPending(): Op[] {
    try {
      const raw = localStorage.getItem(PENDING_KEY(this.boardId))
      return raw ? (JSON.parse(raw) as Op[]) : []
    } catch {
      return []
    }
  }

  private savePending(): void {
    try {
      if (this.pending.length === 0) localStorage.removeItem(PENDING_KEY(this.boardId))
      else localStorage.setItem(PENDING_KEY(this.boardId), JSON.stringify(this.pending))
    } catch {
      // Storage unavailable: edits still flow while the tab is open.
    }
  }
}
