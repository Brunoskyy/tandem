import type { Op, SequencedOp } from './ops.ts'
import type { BoardState, Id, Presence } from './types.ts'

/** Client to server. */
export type ClientMessage =
  | { t: 'join'; boardId: Id; participant: { id: Id; name: string; color: string } }
  | { t: 'op'; op: Op }
  | { t: 'presence'; cursor: { x: number; y: number } | null; editing: Id | null }
  | { t: 'ping' }

/** Server to client. */
export type ServerMessage =
  | { t: 'welcome'; state: BoardState; seq: number; participants: Presence[]; you: Id }
  | { t: 'ops'; ops: SequencedOp[] }
  | { t: 'presence'; participants: Presence[] }
  | { t: 'rejected'; opId: Id; reason: string; code: 'invalid' | 'rate-limit' }
  /** The server already had this op; the client can stop waiting for it. */
  | { t: 'known'; opId: Id }
  | { t: 'error'; reason: string }
  | { t: 'pong' }
