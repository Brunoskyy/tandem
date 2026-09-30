import type { IncomingMessage, Server } from 'node:http'

import {
  InvalidMessage,
  parseId,
  parseParticipantColor,
  parseParticipantName,
  type ClientMessage,
  type Presence,
  type ServerMessage,
} from '@tandem/shared'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

import type { Connection, Room } from './room.ts'
import type { Rooms } from './rooms.ts'

const MAX_MESSAGE_BYTES = 64 * 1024
export const DEFAULT_OPS_PER_SECOND = 40
const HEARTBEAT_MS = 30_000
const PRESENCE_PER_SECOND = 30

export interface SocketOptions {
  /** Per-connection budget; a client past it gets its ops rejected until the next second. */
  opsPerSecond?: number
}

/**
 * The socket layer: one WebSocket per participant, a join handshake, then ops
 * and presence. Everything the client says is parsed by the shared validators
 * before it reaches a room, and the actor of every op is the participant who
 * joined on this socket, never a field in the message.
 */
export function attachWebSockets(
  server: Server,
  rooms: Rooms,
  options: SocketOptions = {},
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  const opsPerSecond = options.opsPerSecond ?? DEFAULT_OPS_PER_SECOND

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    let room: Room | null = null
    let conn: Connection | null = null
    let alive = true
    let tokens = opsPerSecond
    let presenceTokens = PRESENCE_PER_SECOND
    const refill = setInterval(() => {
      tokens = opsPerSecond
      presenceTokens = PRESENCE_PER_SECOND
    }, 1000)
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      ws.ping()
    }, HEARTBEAT_MS)
    ws.on('pong', () => (alive = true))

    const send = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
    }

    ws.on('message', (data, isBinary) => {
      let message: ClientMessage
      try {
        if (isBinary) throw new Error('binary')
        message = JSON.parse(rawToString(data)) as ClientMessage
      } catch {
        send({ t: 'error', reason: 'not JSON' })
        return
      }
      try {
        if (message.t === 'join') {
          if (room) throw new InvalidMessage('already joined')
          const boardId = parseId(message.boardId, 'board id')
          // Validate the participant before a room is loaded, so a bad join
          // cannot leave a room resident with nobody in it.
          const participant: Presence = {
            id: parseId(message.participant?.id, 'participant id'),
            name: parseParticipantName(message.participant?.name),
            color: parseParticipantColor(message.participant?.color),
            cursor: null,
            editing: null,
            seenAt: Date.now(),
          }
          const target = rooms.get(boardId)
          if (!target) {
            send({ t: 'error', reason: 'board not found' })
            ws.close(4004, 'board not found')
            return
          }
          room = target
          conn = { send, participant }
          room.join(conn, typeof message.sinceSeq === 'number' ? message.sinceSeq : 0)
          return
        }
        if (!room || !conn) throw new InvalidMessage('join first')
        switch (message.t) {
          case 'op':
            if (tokens <= 0) {
              send({
                t: 'rejected',
                opId: message.op?.opId ?? '?',
                reason: 'too many changes per second',
                code: 'rate-limit',
              })
              return
            }
            tokens -= 1
            room.receiveOp(conn, message.op)
            return
          case 'presence': {
            // Past the budget, presence is simply dropped: the next one wins anyway.
            if (presenceTokens <= 0) return
            presenceTokens -= 1
            const cursor =
              message.cursor &&
              typeof message.cursor.x === 'number' &&
              typeof message.cursor.y === 'number'
                ? { x: message.cursor.x, y: message.cursor.y }
                : null
            const editing = typeof message.editing === 'string' ? parseId(message.editing) : null
            room.updatePresence(conn, cursor, editing)
            return
          }
          case 'ping':
            send({ t: 'pong' })
            return
          default:
            throw new InvalidMessage('unknown message')
        }
      } catch (e) {
        send({ t: 'error', reason: e instanceof InvalidMessage ? e.message : 'bad message' })
      }
    })

    ws.on('close', () => {
      clearInterval(refill)
      clearInterval(heartbeat)
      if (room && conn) {
        room.leave(conn)
        rooms.release(room)
      }
    })
  })

  return wss
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data as ArrayBuffer).toString('utf8')
}
