import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

// Loaded through the runtime rather than an import statement: bundlers that
// predate node:sqlite rewrite the specifier and break the build.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')

import type { BoardState, Op, SequencedOp } from '@tandem/shared'

/**
 * Persistence is a snapshot plus the ops since it, per board. Restart, load
 * the snapshot, replay the tail, and the room is back where it was. The op
 * log is also what a reconnecting client asks for, so it stays queryable by
 * sequence number rather than becoming a blob.
 */
export class Store {
  private readonly db: DatabaseSyncType

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        snapshot TEXT NOT NULL,
        snapshot_seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ops (
        board_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        op_id TEXT NOT NULL,
        op TEXT NOT NULL,
        PRIMARY KEY (board_id, seq),
        UNIQUE (board_id, op_id)
      );
    `)
  }

  createBoard(state: BoardState): void {
    this.db
      .prepare('INSERT INTO boards (id, snapshot, snapshot_seq, created_at) VALUES (?, ?, 0, ?)')
      .run(state.id, JSON.stringify(state), Date.now())
  }

  loadBoard(id: string): { state: BoardState; seq: number; tail: SequencedOp[] } | null {
    const row = this.db
      .prepare('SELECT snapshot, snapshot_seq FROM boards WHERE id = ?')
      .get(id) as { snapshot: string; snapshot_seq: number } | undefined
    if (!row) return null
    const rows = this.db
      .prepare('SELECT seq, op FROM ops WHERE board_id = ? AND seq > ? ORDER BY seq')
      .all(id, row.snapshot_seq) as Array<{ seq: number; op: string }>
    const tail = rows.map((r) => ({ seq: r.seq, op: JSON.parse(r.op) as Op }))
    const seq = tail.length ? tail[tail.length - 1]!.seq : row.snapshot_seq
    return { state: JSON.parse(row.snapshot) as BoardState, seq, tail }
  }

  /** Returns false when this op id was already stored for the board. */
  appendOp(boardId: string, seq: number, op: Op): boolean {
    try {
      this.db
        .prepare('INSERT INTO ops (board_id, seq, op_id, op) VALUES (?, ?, ?, ?)')
        .run(boardId, seq, op.opId, JSON.stringify(op))
      return true
    } catch (e) {
      if (e instanceof Error && /UNIQUE constraint failed: ops.board_id, ops.op_id/.test(e.message))
        return false
      throw e
    }
  }

  /**
   * The snapshot makes loading fast; the op log is kept whole. Its op ids are
   * what makes a resent op harmless, and a board's whole history is small.
   */
  saveSnapshot(state: BoardState, seq: number): void {
    this.db
      .prepare('UPDATE boards SET snapshot = ?, snapshot_seq = ? WHERE id = ?')
      .run(JSON.stringify(state), seq, state.id)
  }

  opsSince(boardId: string, seq: number): SequencedOp[] {
    const rows = this.db
      .prepare('SELECT seq, op FROM ops WHERE board_id = ? AND seq > ? ORDER BY seq')
      .all(boardId, seq) as Array<{ seq: number; op: string }>
    return rows.map((r) => ({ seq: r.seq, op: JSON.parse(r.op) as Op }))
  }

  close(): void {
    this.db.close()
  }
}
