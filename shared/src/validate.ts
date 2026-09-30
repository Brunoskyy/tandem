import { NOTE_COLORS, type NoteColor, type Phase } from './types.ts'
import type { Op, OpBody } from './ops.ts'

export const LIMITS = {
  noteText: 500,
  title: 80,
  name: 32,
  votesPerPerson: 20,
} as const

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/
/** Names every object already has. Lookups guard against them too; rejecting them here keeps logs clean. */
const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype))

export class InvalidMessage extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function id(v: unknown, what: string): string {
  if (typeof v !== 'string' || !ID_RE.test(v) || RESERVED.has(v)) {
    throw new InvalidMessage(`${what} is not a valid id`)
  }
  return v
}
function text(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string') throw new InvalidMessage(`${what} must be a string`)
  if (v.length > max) throw new InvalidMessage(`${what} is longer than ${max} characters`)
  return v
}
function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new InvalidMessage(`${what} must be a finite number`)
  return v
}
function color(v: unknown): NoteColor {
  if (typeof v !== 'string' || !(NOTE_COLORS as readonly string[]).includes(v)) {
    throw new InvalidMessage('color is not in the palette')
  }
  return v as NoteColor
}
function phase(v: unknown): Phase {
  if (v !== 'write' && v !== 'discuss') throw new InvalidMessage('phase must be write or discuss')
  return v
}

/**
 * Turns untrusted JSON into an Op or throws. Hand-written on purpose: the
 * shapes are few, and the error messages can say what a person did wrong.
 */
export function parseOpBody(v: unknown): OpBody {
  if (!isRecord(v) || typeof v.kind !== 'string') throw new InvalidMessage('op has no kind')
  switch (v.kind) {
    case 'note.create':
      return {
        kind: 'note.create',
        id: id(v.id, 'note id'),
        columnId: id(v.columnId, 'column id'),
        text: text(v.text, 'text', LIMITS.noteText),
        color: color(v.color),
        order: num(v.order, 'order'),
      }
    case 'note.update': {
      const body: OpBody = { kind: 'note.update', id: id(v.id, 'note id') }
      if (v.text !== undefined) body.text = text(v.text, 'text', LIMITS.noteText)
      if (v.color !== undefined) body.color = color(v.color)
      if (body.text === undefined && body.color === undefined)
        throw new InvalidMessage('note.update changes nothing')
      return body
    }
    case 'note.move':
      return {
        kind: 'note.move',
        id: id(v.id, 'note id'),
        columnId: id(v.columnId, 'column id'),
        order: num(v.order, 'order'),
      }
    case 'note.delete':
      return { kind: 'note.delete', id: id(v.id, 'note id') }
    case 'vote.set':
      if (typeof v.on !== 'boolean') throw new InvalidMessage('vote.set needs on: boolean')
      return { kind: 'vote.set', noteId: id(v.noteId, 'note id'), on: v.on }
    case 'column.create':
      return {
        kind: 'column.create',
        id: id(v.id, 'column id'),
        title: text(v.title, 'title', LIMITS.title),
        order: num(v.order, 'order'),
      }
    case 'column.update': {
      const body: OpBody = { kind: 'column.update', id: id(v.id, 'column id') }
      if (v.title !== undefined) body.title = text(v.title, 'title', LIMITS.title)
      if (v.order !== undefined) body.order = num(v.order, 'order')
      return body
    }
    case 'column.delete':
      return { kind: 'column.delete', id: id(v.id, 'column id') }
    case 'board.update': {
      const body: OpBody = { kind: 'board.update' }
      if (v.title !== undefined) body.title = text(v.title, 'title', LIMITS.title)
      if (v.phase !== undefined) body.phase = phase(v.phase)
      if (v.votesPerPerson !== undefined) {
        const n = num(v.votesPerPerson, 'votesPerPerson')
        if (!Number.isInteger(n) || n < 0 || n > LIMITS.votesPerPerson) {
          throw new InvalidMessage(
            `votesPerPerson must be an integer from 0 to ${LIMITS.votesPerPerson}`,
          )
        }
        body.votesPerPerson = n
      }
      return body
    }
    default:
      throw new InvalidMessage(`unknown op kind ${String(v.kind)}`)
  }
}

/** Parses an op from the wire and pins the actor to the socket's participant. */
export function parseOp(v: unknown, actor: string): Op {
  if (!isRecord(v)) throw new InvalidMessage('op must be an object')
  return {
    opId: id(v.opId, 'opId'),
    actor,
    at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : Date.now(),
    body: parseOpBody(v.body),
  }
}

export function parseParticipantName(v: unknown): string {
  const name = text(v, 'name', LIMITS.name).trim()
  if (name.length === 0) throw new InvalidMessage('name is empty')
  return name
}

export function parseId(v: unknown, what = 'id'): string {
  return id(v, what)
}

export const PEOPLE_COLORS = [
  '#0f766e',
  '#b45309',
  '#7c3aed',
  '#be185d',
  '#1d4ed8',
  '#15803d',
  '#c2410c',
  '#4338ca',
] as const

/** A participant color is one of ours, never a string that ends up in a style attribute. */
export function parseParticipantColor(v: unknown): string {
  if (typeof v === 'string' && (PEOPLE_COLORS as readonly string[]).includes(v)) return v
  return PEOPLE_COLORS[0]
}
