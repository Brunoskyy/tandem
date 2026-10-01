import { afterEach, describe, expect, it } from 'vitest'

import { Client, createBoard, sleep, startApp, type TestApp } from './helpers.ts'

const apps: TestApp[] = []
const clients: Client[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  await Promise.all(apps.splice(0).map((a) => a.close()))
})

async function boot() {
  const t = await startApp()
  apps.push(t)
  return t
}
function client(port: number) {
  const c = new Client(port)
  clients.push(c)
  return c
}

describe('boards over HTTP', () => {
  it('creates a board from a template and exposes it', async () => {
    const t = await boot()
    const id = await createBoard(t, 'Retro 12', 'starfish')
    const res = await fetch(`http://127.0.0.1:${t.port}/api/boards/${id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id, title: 'Retro 12', phase: 'write' })
    expect((await fetch(`http://127.0.0.1:${t.port}/api/boards/nope`)).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${t.port}/api/boards/..%2Fetc`)).status).toBe(404)
  })

  it('exports markdown ordered by votes', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    const welcome = await ana.join(id, 'Ana')
    const col = Object.keys(welcome.state.columns)[0]!
    ana.send({
      t: 'op',
      op: {
        opId: 'o1',
        actor: 'ana',
        at: 1,
        body: {
          kind: 'note.create',
          id: 'n1',
          columnId: col,
          text: 'Fewer meetings',
          color: 'yellow',
          order: 0,
        },
      },
    })
    ana.send({
      t: 'op',
      op: {
        opId: 'o2',
        actor: 'ana',
        at: 1,
        body: {
          kind: 'note.create',
          id: 'n2',
          columnId: col,
          text: 'Pairing worked',
          color: 'yellow',
          order: 1,
        },
      },
    })
    ana.send({
      t: 'op',
      op: { opId: 'o3', actor: 'ana', at: 1, body: { kind: 'vote.set', noteId: 'n2', on: true } },
    })
    await ana.next('ops', (m) => m.ops[0]?.seq === 3)
    const early = await fetch(`http://127.0.0.1:${t.port}/api/boards/${id}/export`)
    expect(early.status).toBe(409)
    ana.send({
      t: 'op',
      op: { opId: 'o4', actor: 'ana', at: 1, body: { kind: 'board.update', phase: 'discuss' } },
    })
    await ana.next('ops', (m) => m.ops[0]?.seq === 4)
    const md = await (await fetch(`http://127.0.0.1:${t.port}/api/boards/${id}/export`)).text()
    expect(md).toContain(
      '# Sprint 12\n\n## Went well\n\n- Pairing worked (1 vote)\n- Fewer meetings\n',
    )
    expect(md).toContain('## Action items\n\n_Nothing here._')
  })
})

describe('sync over WebSocket', () => {
  it('two clients converge on the same state', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    const bea = client(t.port)
    const welcome = await ana.join(id, 'Ana')
    await bea.join(id, 'Bea')
    const col = Object.keys(welcome.state.columns)[0]!
    ana.send({
      t: 'op',
      op: { opId: 'a0', actor: 'ana', at: 1, body: { kind: 'board.update', phase: 'discuss' } },
    })

    ana.send({
      t: 'op',
      op: {
        opId: 'a1',
        actor: 'ana',
        at: 1,
        body: {
          kind: 'note.create',
          id: 'n1',
          columnId: col,
          text: 'from ana',
          color: 'yellow',
          order: 0,
        },
      },
    })
    bea.send({
      t: 'op',
      op: {
        opId: 'b1',
        actor: 'bea',
        at: 1,
        body: {
          kind: 'note.create',
          id: 'n2',
          columnId: col,
          text: 'from bea',
          color: 'pink',
          order: 1,
        },
      },
    })
    bea.send({
      t: 'op',
      op: {
        opId: 'b2',
        actor: 'bea',
        at: 2,
        body: { kind: 'note.update', id: 'n1', text: 'edited by bea' },
      },
    })

    const [a, b] = await Promise.all([
      ana.next('ops', (m) => m.ops[0]?.seq === 4),
      bea.next('ops', (m) => m.ops[0]?.seq === 4),
    ])
    expect(a).toEqual(b)
    const seqsSeenByAna = ana.messages
      .filter((m) => m.t === 'ops')
      .map((m) => (m as { ops: Array<{ seq: number }> }).ops[0]!.seq)
    expect(seqsSeenByAna).toEqual([1, 2, 3, 4])

    // A late joiner gets the resulting state, with the actor taken from the socket.
    const cid = client(t.port)
    const late = await cid.join(id, 'Cid')
    expect(late.seq).toBe(4)
    expect(late.state.notes.n1).toMatchObject({ text: 'edited by bea', authorId: 'ana' })
    expect(late.state.notes.n2).toMatchObject({ authorId: 'bea' })
    expect(late.participants.map((p) => p.name).sort()).toEqual(['Ana', 'Bea', 'Cid'])
  })

  it('ignores a resent op and rejects an invalid one', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    const welcome = await ana.join(id, 'Ana')
    const col = Object.keys(welcome.state.columns)[0]!
    const op = {
      opId: 'dup',
      actor: 'ana',
      at: 1,
      body: {
        kind: 'note.create',
        id: 'n1',
        columnId: col,
        text: 'once',
        color: 'yellow',
        order: 0,
      },
    }
    ana.send({ t: 'op', op })
    ana.send({ t: 'op', op })
    ana.send({
      t: 'op',
      op: {
        opId: 'bad',
        actor: 'ana',
        at: 1,
        body: { kind: 'note.create', id: 'n2', columnId: col, text: 'x', color: 'red', order: 0 },
      },
    })
    const rejected = await ana.next('rejected')
    expect(rejected).toEqual({
      t: 'rejected',
      opId: 'bad',
      reason: 'color is not in the palette',
      code: 'invalid',
    })
    expect(ana.messages.filter((m) => m.t === 'ops')).toHaveLength(1)
    expect(await ana.next('known')).toEqual({ t: 'known', opId: 'dup' })
    const bea = client(t.port)
    expect((await bea.join(id, 'Bea')).seq).toBe(1)
  })

  it('pins the actor to the connection, so votes cannot be cast as someone else', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    const welcome = await ana.join(id, 'Ana')
    const col = Object.keys(welcome.state.columns)[0]!
    ana.send({
      t: 'op',
      op: {
        opId: 'o1',
        actor: 'ana',
        at: 1,
        body: { kind: 'note.create', id: 'n1', columnId: col, text: '', color: 'yellow', order: 0 },
      },
    })
    ana.send({
      t: 'op',
      op: { opId: 'o2', actor: 'bea', at: 1, body: { kind: 'vote.set', noteId: 'n1', on: true } },
    })
    const m = await ana.next('ops', (x) => x.ops[0]?.seq === 2)
    expect(m.ops[0]?.op.actor).toBe('ana')
  })

  it('relays presence and drops it on disconnect', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    const bea = client(t.port)
    await ana.join(id, 'Ana')
    await bea.join(id, 'Bea')
    bea.send({ t: 'presence', cursor: { x: 10, y: 20 }, editing: null })
    const p = await ana.next('presence', (m) => m.participants.some((x) => x.cursor?.x === 10))
    expect(p.participants.find((x) => x.id === 'bea')).toMatchObject({
      name: 'Bea',
      cursor: { x: 10, y: 20 },
    })
    bea.close()
    const gone = await ana.next('presence', (m) => m.participants.length === 1)
    expect(gone.participants[0]?.id).toBe('ana')
  })

  it('refuses ops before join and unknown boards', async () => {
    const t = await boot()
    const c = client(t.port)
    await c.open()
    c.send({
      t: 'op',
      op: { opId: 'o', actor: 'x', at: 1, body: { kind: 'note.delete', id: 'n' } },
    })
    expect(await c.next('error')).toEqual({ t: 'error', reason: 'join first' })
    const d = client(t.port)
    await d.open()
    d.send({
      t: 'join',
      boardId: 'missing',
      participant: { id: 'x', name: 'X', color: 'teal' },
    })
    expect((await d.closed()).code).toBe(4004)
  })

  it('rate limits a client that floods', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    await ana.join(id, 'Ana')
    for (let i = 0; i < 60; i += 1) {
      ana.send({
        t: 'op',
        op: { opId: `f${i}`, actor: 'ana', at: 1, body: { kind: 'board.update', title: `t${i}` } },
      })
    }
    const r = await ana.next('rejected')
    expect(r.reason).toMatch(/too many/)
  })
})

describe('review findings', () => {
  it('keeps other people’s text out of the socket until the board is revealed', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    const bea = client(t.port)
    const welcome = await ana.join(id, 'Ana')
    await bea.join(id, 'Bea')
    const col = Object.keys(welcome.state.columns)[0]!
    ana.send({
      t: 'op',
      op: {
        opId: 'a1',
        actor: 'ana',
        at: 1,
        body: {
          kind: 'note.create',
          id: 'n1',
          columnId: col,
          text: 'secret',
          color: 'yellow',
          order: 0,
        },
      },
    })
    ana.send({
      t: 'op',
      op: {
        opId: 'a2',
        actor: 'ana',
        at: 1,
        body: { kind: 'note.update', id: 'n1', text: 'still secret', color: 'pink' },
      },
    })
    const seen = await bea.next('ops', (m) => m.ops[0]?.seq === 2)
    const first = bea.messages.find((m) => m.t === 'ops') as {
      ops: Array<{ op: { body: { text?: string } } }>
    }
    expect(first.ops[0]?.op.body.text).toBe('')
    expect(seen.ops[0]?.op.body).toEqual({ kind: 'note.update', id: 'n1', color: 'pink' })
    expect(JSON.stringify(bea.messages)).not.toContain('secret')

    const cid = client(t.port)
    const late = await cid.join(id, 'Cid')
    expect(late.state.notes.n1?.text).toBe('')
    expect((await ana.next('ops', (m) => m.ops[0]?.seq === 2)).ops[0]?.op.body).toMatchObject({
      text: 'still secret',
    })

    bea.send({
      t: 'op',
      op: { opId: 'b1', actor: 'bea', at: 1, body: { kind: 'board.update', phase: 'discuss' } },
    })
    const revealed = await cid.next('welcome', (m) => m.state.phase === 'discuss')
    expect(revealed.state.notes.n1?.text).toBe('still secret')
  })

  it('refuses ids that every object already has', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    const welcome = await ana.join(id, 'Ana')
    const col = Object.keys(welcome.state.columns)[0]!
    for (const bad of ['constructor', '__proto__', 'toString']) {
      ana.send({
        t: 'op',
        op: {
          opId: `x-${bad}`,
          actor: 'ana',
          at: 1,
          body: { kind: 'note.move', id: bad, columnId: col, order: 0 },
        },
      })
      const r = await ana.next('rejected', (m) => m.opId === `x-${bad}`)
      expect(r.reason).toMatch(/not a valid id/)
    }
    ana.send({
      t: 'op',
      op: { opId: 'v', actor: 'ana', at: 1, body: { kind: 'board.update', phase: 'discuss' } },
    })
    await ana.next('ops', (m) => m.ops[0]?.seq === 1)
    const md = await (await fetch(`http://127.0.0.1:${t.port}/api/boards/${id}/export`)).text()
    expect(md).not.toContain('constructor')
  })

  it('refuses participant colors outside the palette', async () => {
    const t = await boot()
    const id = await createBoard(t)
    const ana = client(t.port)
    await ana.open()
    ana.send({
      t: 'join',
      boardId: id,
      participant: { id: 'ana', name: 'Ana', color: 'url(//evil)' },
    })
    const w = await ana.next('welcome')
    expect(w.participants[0]?.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('does not keep a room in memory for an HTTP read', async () => {
    const t = await boot()
    const id = await createBoard(t)
    expect((await fetch(`http://127.0.0.1:${t.port}/api/boards/${id}`)).status).toBe(200)
    t.app.rooms.sweep(Date.now() + 10 * 60_000)
    // Peeking twice yields the same state and never a resident room.
    expect(t.app.rooms.peek(id)?.title).toBe('Sprint 12')
    expect((t.app.rooms as unknown as { rooms: Map<string, unknown> }).rooms.size).toBe(0)

    const ana = client(t.port)
    await ana.join(id, 'Ana')
    expect((t.app.rooms as unknown as { rooms: Map<string, unknown> }).rooms.size).toBe(1)
    ana.close()
    await sleep(80)
    t.app.rooms.sweep(Date.now() + 10 * 60_000)
    expect((t.app.rooms as unknown as { rooms: Map<string, unknown> }).rooms.size).toBe(0)
  })
})

describe('persistence', () => {
  it('survives a restart, including snapshots', async () => {
    const t = await startApp(undefined, 1000)
    apps.push(t)
    const id = await createBoard(t)
    const ana = client(t.port)
    const welcome = await ana.join(id, 'Ana')
    const col = Object.keys(welcome.state.columns)[0]!
    for (let i = 0; i < 60; i += 1) {
      ana.send({
        t: 'op',
        op: {
          opId: `o${i}`,
          actor: 'ana',
          at: 1,
          body: {
            kind: 'note.create',
            id: `n${i}`,
            columnId: col,
            text: `${i}`,
            color: 'green',
            order: i,
          },
        },
      })
      if (i % 20 === 19) await ana.next('ops', (m) => m.ops[0]?.seq === i + 1)
    }
    await ana.next('ops', (m) => m.ops[0]?.seq === 60)
    ana.close()
    await sleep(20)
    const dbPath = t.dbPath
    await t.app.close()
    apps.splice(apps.indexOf(t), 1)

    const again = await startApp(dbPath, 1000)
    apps.push(again)
    const bea = client(again.port)
    const w = await bea.join(id, 'Bea')
    expect(w.seq).toBe(60)
    expect(Object.keys(w.state.notes)).toHaveLength(60)
    bea.send({
      t: 'op',
      op: { opId: 'o0', actor: 'bea', at: 1, body: { kind: 'note.delete', id: 'n0' } },
    })
    bea.send({
      t: 'op',
      op: { opId: 'after', actor: 'bea', at: 1, body: { kind: 'note.delete', id: 'n1' } },
    })
    const m = await bea.next('ops')
    // The duplicate op id from before the restart is still remembered; only the new op lands.
    expect(m.ops[0]).toMatchObject({ seq: 61, op: { opId: 'after' } })
  })
})
