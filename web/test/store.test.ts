import { newBoard, TEMPLATES, type Op } from '@tandem/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BoardStore } from '../src/sync/store.ts'
import { FakeSocket, factory } from './fakeSocket.ts'

let n = 0
const board = () => newBoard('b1', 'Retro', TEMPLATES[0]!, () => `c${++n}`)
const me = { id: 'ana', name: 'Ana', color: '#000' }

function connected() {
  const store = new BoardStore('b1', me, { url: 'ws://test/ws', socketFactory: factory })
  store.start()
  const ws = FakeSocket.instances[FakeSocket.instances.length - 1]!
  ws.open()
  const state = board()
  ws.receive({ t: 'welcome', state, seq: 0, participants: [], you: 'ana' })
  return { store, ws, state, col: Object.keys(state.columns)[0]! }
}

beforeEach(() => {
  FakeSocket.instances = []
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('BoardStore', () => {
  it('joins on open and exposes the welcome state', () => {
    const { store, ws } = connected()
    expect(ws.sent[0]).toMatchObject({ t: 'join', boardId: 'b1', participant: me })
    expect(store.getSnapshot().status).toBe('online')
    expect(store.getSnapshot().board?.title).toBe('Retro')
  })

  it('applies a change immediately and sends it', () => {
    const { store, ws, col } = connected()
    store.dispatch({
      kind: 'note.create',
      id: 'n1',
      columnId: col,
      text: 'hi',
      color: 'yellow',
      order: 0,
    })
    expect(store.getSnapshot().board?.notes.n1?.text).toBe('hi')
    expect(store.getSnapshot().pendingCount).toBe(1)
    expect(ws.sent[1]).toMatchObject({
      t: 'op',
      op: { actor: 'ana', body: { kind: 'note.create', id: 'n1' } },
    })
  })

  it('drops the pending op when the server confirms it', () => {
    const { store, ws, col } = connected()
    const op = store.dispatch({
      kind: 'note.create',
      id: 'n1',
      columnId: col,
      text: 'hi',
      color: 'yellow',
      order: 0,
    })
    ws.receive({ t: 'ops', ops: [{ seq: 1, op }] })
    expect(store.getSnapshot().pendingCount).toBe(0)
    expect(store.getSnapshot().board?.notes.n1?.text).toBe('hi')
  })

  it('keeps our edit on top of a remote edit until the server orders them', () => {
    const { store, ws, col } = connected()
    const create: Op = {
      opId: 'x',
      actor: 'bea',
      at: 1,
      body: { kind: 'note.create', id: 'n1', columnId: col, text: 'bea', color: 'pink', order: 0 },
    }
    ws.receive({ t: 'ops', ops: [{ seq: 1, op: create }] })
    const mine = store.dispatch({ kind: 'note.update', id: 'n1', text: 'ana' })
    const theirs: Op = {
      opId: 'y',
      actor: 'bea',
      at: 2,
      body: { kind: 'note.update', id: 'n1', text: 'bea again' },
    }
    ws.receive({ t: 'ops', ops: [{ seq: 2, op: theirs }] })
    // Pending still applies over confirmed: we see our own text until ordered.
    expect(store.getSnapshot().board?.notes.n1?.text).toBe('ana')
    ws.receive({ t: 'ops', ops: [{ seq: 3, op: mine }] })
    expect(store.getSnapshot().board?.notes.n1?.text).toBe('ana')
    expect(store.getSnapshot().pendingCount).toBe(0)
  })

  it('reverts a rejected op and says so', () => {
    const { store, ws, col } = connected()
    const op = store.dispatch({
      kind: 'note.create',
      id: 'n1',
      columnId: col,
      text: 'hi',
      color: 'yellow',
      order: 0,
    })
    ws.receive({
      t: 'rejected',
      opId: op.opId,
      reason: 'text is longer than 500 characters',
      code: 'invalid',
    })
    expect(store.getSnapshot().board?.notes.n1).toBeUndefined()
    expect(store.getSnapshot().toasts[0]?.text).toMatch(/not accepted: text is longer/)
  })

  it('resends pending ops after a reconnect and persists them meanwhile', () => {
    const { store, ws, col, state } = connected()
    ws.drop()
    expect(store.getSnapshot().status).toBe('offline')
    const op = store.dispatch({
      kind: 'note.create',
      id: 'n1',
      columnId: col,
      text: 'offline',
      color: 'blue',
      order: 0,
    })
    expect(store.getSnapshot().board?.notes.n1?.text).toBe('offline')
    expect(JSON.parse(localStorage.getItem('tandem.pending.b1') ?? '[]')).toHaveLength(1)

    vi.advanceTimersByTime(600)
    const ws2 = FakeSocket.instances[1]!
    expect(ws2).not.toBe(ws)
    ws2.open()
    expect(ws2.sent[0]).toMatchObject({ t: 'join' })
    ws2.receive({ t: 'welcome', state, seq: 0, participants: [], you: 'ana' })
    expect(ws2.sent[1]).toMatchObject({ t: 'op', op: { opId: op.opId } })
    expect(store.getSnapshot().status).toBe('online')
    expect(store.getSnapshot().board?.notes.n1?.text).toBe('offline')
  })

  it('loads pending ops left by a previous session', () => {
    const op: Op = {
      opId: 'old',
      actor: 'ana',
      at: 1,
      body: { kind: 'board.update', title: 'From last time' },
    }
    localStorage.setItem('tandem.pending.b1', JSON.stringify([op]))
    const { store, ws } = connected()
    expect(store.getSnapshot().board?.title).toBe('From last time')
    expect(ws.sent.some((m) => m.t === 'op' && m.op.opId === 'old')).toBe(true)
  })

  it('backs off between reconnects', () => {
    const { ws } = connected()
    ws.drop()
    vi.advanceTimersByTime(499)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1]!.drop()
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(2)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('stops retrying when the board does not exist', () => {
    const { store, ws } = connected()
    ws.receive({ t: 'error', reason: 'board not found' })
    ws.drop(4004)
    vi.advanceTimersByTime(20_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(store.getSnapshot().fatal).toMatch(/does not exist/)
  })

  it('drops a pending op the server says it already has', () => {
    const { store, ws, col } = connected()
    const op = store.dispatch({
      kind: 'note.create',
      id: 'n1',
      columnId: col,
      text: 'hi',
      color: 'yellow',
      order: 0,
    })
    ws.receive({ t: 'known', opId: op.opId })
    expect(store.getSnapshot().pendingCount).toBe(0)
  })

  it('keeps a rate-limited op and retries it', () => {
    const { store, ws } = connected()
    const op = store.dispatch({ kind: 'board.update', title: 'x' })
    ws.receive({
      t: 'rejected',
      opId: op.opId,
      reason: 'too many changes per second',
      code: 'rate-limit',
    })
    expect(store.getSnapshot().pendingCount).toBe(1)
    expect(store.getSnapshot().toasts).toEqual([])
    const before = ws.sent.filter((m) => m.t === 'op').length
    vi.advanceTimersByTime(1200)
    expect(ws.sent.filter((m) => m.t === 'op').length).toBe(before + 1)
  })

  it('paces a long resend after reconnecting', () => {
    const { store, ws, state } = connected()
    ws.drop()
    for (let i = 0; i < 45; i += 1) store.dispatch({ kind: 'board.update', title: `t${i}` })
    vi.advanceTimersByTime(600)
    const ws2 = FakeSocket.instances[1]!
    ws2.open()
    ws2.receive({ t: 'welcome', state, seq: 0, participants: [], you: 'ana' })
    expect(ws2.sent.filter((m) => m.t === 'op')).toHaveLength(20)
    vi.advanceTimersByTime(650)
    expect(ws2.sent.filter((m) => m.t === 'op')).toHaveLength(40)
    vi.advanceTimersByTime(650)
    expect(ws2.sent.filter((m) => m.t === 'op')).toHaveLength(45)
  })

  it('throttles presence to the last value', () => {
    const { store, ws } = connected()
    store.presence({ x: 1, y: 1 }, null)
    store.presence({ x: 2, y: 2 }, 'n1')
    expect(ws.sent.filter((m) => m.t === 'presence')).toHaveLength(0)
    vi.advanceTimersByTime(60)
    expect(ws.sent.filter((m) => m.t === 'presence')).toEqual([
      { t: 'presence', cursor: { x: 2, y: 2 }, editing: 'n1' },
    ])
  })
})
