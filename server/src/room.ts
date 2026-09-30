import {
  applyOp,
  applyOps,
  opVisibleTo,
  parseOp,
  visibleTo,
  InvalidMessage,
  type BoardState,
  type Id,
  type Op,
  type Presence,
  type SequencedOp,
  type ServerMessage,
} from '@tandem/shared'

import type { Store } from './store.ts'

export interface Connection {
  send(message: ServerMessage): void
  participant: Presence
}

const SNAPSHOT_EVERY = 50

/**
 * One board in memory: authoritative state, the sequence counter, and who is
 * connected. All ordering happens here, on one thread, which is the whole
 * concurrency story: there is nothing to lock.
 */
export class Room {
  state: BoardState
  seq: number
  private readonly connections = new Set<Connection>()
  private sinceSnapshot = 0

  constructor(
    private readonly store: Store,
    loaded: { state: BoardState; seq: number; tail: SequencedOp[] },
  ) {
    this.state = applyOps(
      loaded.state,
      loaded.tail.map((t) => t.op),
    )
    this.seq = loaded.seq
  }

  get id(): Id {
    return this.state.id
  }

  get size(): number {
    return this.connections.size
  }

  /**
   * A joining client always gets the full state. On a reconnect it would be
   * possible to send only the ops after `sinceSeq`, but a board is small
   * (hundreds of notes at most) and one message that is always right beats
   * two code paths. `sinceSeq` is kept in the protocol for that future.
   */
  join(conn: Connection, _sinceSeq: number): void {
    this.connections.add(conn)
    this.welcome(conn)
    this.broadcastPresence()
  }

  private welcome(conn: Connection): void {
    conn.send({
      t: 'welcome',
      state: visibleTo(this.state, conn.participant.id),
      seq: this.seq,
      participants: this.presences(),
      you: conn.participant.id,
    })
  }

  leave(conn: Connection): void {
    this.connections.delete(conn)
    this.broadcastPresence()
  }

  /** Validates, orders, persists and broadcasts one op from a client. */
  receiveOp(conn: Connection, raw: unknown): void {
    let op: Op
    try {
      op = parseOp(raw, conn.participant.id)
    } catch (e) {
      const opId =
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as { opId?: unknown }).opId === 'string'
          ? (raw as { opId: string }).opId
          : '?'
      conn.send({
        t: 'rejected',
        opId,
        reason: e instanceof InvalidMessage ? e.message : 'invalid op',
        code: 'invalid',
      })
      return
    }

    const next = applyOp(this.state, op)
    const seq = this.seq + 1
    if (!this.store.appendOp(this.id, seq, op)) {
      // Same opId again: a client resent after a lost ack. It was applied the
      // first time; tell the client so it stops waiting.
      conn.send({ t: 'known', opId: op.opId })
      return
    }
    const before = this.state
    this.state = next
    this.seq = seq
    this.sinceSnapshot += 1
    if (this.sinceSnapshot >= SNAPSHOT_EVERY) {
      this.store.saveSnapshot(this.state, this.seq)
      this.sinceSnapshot = 0
    }
    for (const c of this.connections) {
      c.send({ t: 'ops', ops: [{ seq, op: opVisibleTo(before, op, c.participant.id) }] })
    }
    // Revealing the board: everyone now gets the text they were not sent before.
    if (before.phase === 'write' && this.state.phase === 'discuss') {
      for (const c of this.connections) this.welcome(c)
    }
  }

  updatePresence(conn: Connection, cursor: Presence['cursor'], editing: Id | null): void {
    conn.participant.cursor = cursor
    conn.participant.editing = editing
    conn.participant.seenAt = Date.now()
    this.broadcastPresence()
  }

  opsSince(seq: number): SequencedOp[] {
    return this.store.opsSince(this.id, seq)
  }

  flush(): void {
    if (this.sinceSnapshot > 0) {
      this.store.saveSnapshot(this.state, this.seq)
      this.sinceSnapshot = 0
    }
  }

  private presences(): Presence[] {
    return [...this.connections].map((c) => c.participant)
  }

  private broadcastPresence(): void {
    const message: ServerMessage = { t: 'presence', participants: this.presences() }
    for (const c of this.connections) c.send(message)
  }
}
