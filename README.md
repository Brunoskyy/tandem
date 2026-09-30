<p align="center">
  <img src="docs/logo.svg" width="76" alt="">
</p>

<h1 align="center">Tandem</h1>

<p align="center">
  A realtime board for retros and brainstorms.<br>
  <sub>React 19 · TypeScript · WebSockets · Node 24 · SQLite, no ORM</sub>
</p>

<br>

Sticky notes, columns, votes and live cursors, shared by everyone with the
link. People write in private first, so nobody anchors on the first card;
then the board is revealed, votes open, and the result exports as markdown.

The part I built this for is underneath: a small sync protocol you can read
in one sitting. No CRDT library, no Firebase. Every change is an op, the
server orders them, and each client keeps its own unconfirmed ops replayed
on top of what the server has confirmed. That is what makes an edit show up
instantly, survive a lost connection, and still end up identical on every
screen.

![Two people on a board in the discussion phase](docs/screenshots/discussing.jpg)

## Running it

```bash
nvm use            # Node 24, for node:sqlite
npm install
npm run dev        # API on :8787, Vite on :5173 proxying /api and /ws
```

Open http://localhost:5173, create a board, and open the link in a second
window (a private one, so it gets its own name) to see the other side.

| Command                                                                      |                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm test`                                                                   | all three workspaces                                                     |
| `npm run typecheck`                                                          | `tsc` per workspace                                                      |
| `npm run build`                                                              | client to `web/dist`, server to `server/dist`                            |
| `npm start`                                                                  | production: one process serves the API, the sockets and the built client |
| `docker build -t tandem . && docker run -p 8787:8787 -v tandem:/data tandem` | the same, in a container                                                 |

## How the sync works

```
client                          server                         other clients
  │ apply op locally               │                                │
  │ ──── op ─────────────────────▶ │ validate, pin actor            │
  │      (kept in pending[])       │ seq = n+1, append to log       │
  │ ◀─── ops [{seq, op}] ───────── │ ──── ops [{seq, op}] ────────▶ │ apply
  │ apply to confirmed,            │                                │
  │ drop from pending              │                                │
```

- **The board is a plain object; every change is an op.** `applyOp` in
  `shared/src/ops.ts` is pure and idempotent. Stale ops (a note that was
  deleted, a duplicate create) are no-ops rather than errors, because with
  several people editing they are the normal case.
- **The server is the clock.** One room per board, one thread, a sequence
  number per accepted op. "Last writer wins" simply means "the op the server
  saw last". There is nothing to lock.
- **Clients are optimistic, and honest about it.** The store keeps
  `confirmed` (exactly what the server sent, in order) and `pending` (what we
  changed and have not heard back about). The view is `pending` replayed
  over `confirmed`. When our op comes back with a seq it moves from one to
  the other, and the view does not flicker because the result is the same.
- **Reconnects are boring.** Pending ops live in `localStorage`. On reconnect
  the client joins again, gets the full state, and resends whatever is still
  pending. The server ignores op ids it has already applied, so a retry after
  a lost ack is safe.
- **Positions are fractional.** Dragging a card between two others takes the
  midpoint of their positions, so nobody else's card has to move and two
  drags in the same column do not fight. Doubles run out of room after a few
  dozen inserts into the same gap; the client notices and spreads the column
  back out.
- **Votes are a set per participant.** Two people voting on the same note at
  the same time cannot clobber each other, and the per-person cap is checked
  in `applyOp`, so it holds no matter which order the server picks.

## Things worth opening

**`shared/src/validate.ts`.** Hand-written parsers instead of a schema
library. There are nine op shapes, the error messages say what a person did
wrong, and unknown fields never reach the state. The actor of every op is the
participant who joined on that socket, whatever the message claims.

**`web/src/sync/store.ts`.** The confirmed/pending split, about 150 lines.
The tests drive it with a fake socket: drop the connection, edit offline,
reconnect, watch the edit resend and land.

**`web/src/components/Board.tsx`.** Drag and drop with pointer events and
`elementFromPoint`, no library. The column under the pointer and the
midpoints of its cards decide the drop index. Alt with an arrow key does the
same thing from the keyboard.

**`server/src/store.ts`.** Persistence is a snapshot plus the ops since it,
in SQLite through `node:sqlite`, so there is no native module to build. A
restart replays the tail. The op log doubles as the source for a client
catching up by sequence number.

**Presence is separate from state.** Cursors and "Bea is editing" go over
the same socket but never touch the board or the log. They are throttled to
one message per 50ms with the last value winning.

## Tests

```bash
npm test
```

43 tests. The shared layer is covered as pure functions: op semantics,
concurrent edits in both orders, the vote cap, fractional ordering,
validation of everything a client could send. The server tests start a real
process on a random port and talk to it with real sockets: two clients
converging, a late joiner, duplicate and invalid ops, actor spoofing, presence
on disconnect, rate limiting, and a restart with sixty ops and a snapshot in
between. The client tests use a fake socket to script the connection going
away and coming back.

## Layout

```
shared/src/
  types.ts       board, note, column, participant
  ops.ts         applyOp: the one function that changes state
  order.ts       fractional positions
  validate.ts    untrusted JSON to Op, or an error that says why
  protocol.ts    messages in each direction
server/src/
  room.ts        one board: order, persist, broadcast
  rooms.ts       load on first join, evict when idle
  store.ts       SQLite: snapshot + op log per board
  ws.ts          join handshake, rate limit, heartbeat
  http.ts        create, export, static files with SPA fallback
web/src/
  sync/          connection (reconnect, backoff) and the store
  components/    Board, Column, NoteCard, Cursors, Presence
  lib/dnd.ts     drop index and move ops, pure
```

## What's missing

- No accounts. Whoever has the link is in, and the name you pick is the
  name you get. Fine for a team call, not for anything sensitive.
- Text conflicts are last-writer-wins per note, not per character. Two
  people typing in the same card at the same second will lose one of the
  edits; the "is editing" hint exists to make that rare, not impossible.
  Character-level merging is what a CRDT is for, and a sticky note did not
  justify one.
- Boards are never deleted. There is no owner to ask.
- A shared timer would be a natural next op.
