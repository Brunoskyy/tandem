import { newBoard, TEMPLATES, type BoardState, type Template } from '@tandem/shared'

import { newId } from './ids.ts'
import { Room } from './room.ts'
import type { Store } from './store.ts'

/** Rooms are loaded on first join and dropped once empty for a while. */
export class Rooms {
  private readonly rooms = new Map<string, Room>()
  private readonly idleSince = new Map<string, number>()

  constructor(
    private readonly store: Store,
    private readonly idleMs = 5 * 60_000,
  ) {}

  create(title: string, templateKey: string): BoardState {
    const template: Template = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0]!
    const state = newBoard(newId(), title, template, () => newId(6))
    this.store.createBoard(state)
    return state
  }

  get(id: string): Room | null {
    const existing = this.rooms.get(id)
    if (existing) {
      this.idleSince.delete(id)
      return existing
    }
    const loaded = this.store.loadBoard(id)
    if (!loaded) return null
    const room = new Room(this.store, loaded)
    this.rooms.set(id, room)
    return room
  }

  exists(id: string): boolean {
    return this.rooms.has(id) || this.store.loadBoard(id) !== null
  }

  /** Called when a connection leaves; the room is kept for a grace period. */
  release(room: Room): void {
    if (room.size === 0) this.idleSince.set(room.id, Date.now())
  }

  sweep(now = Date.now()): void {
    for (const [id, since] of this.idleSince) {
      if (now - since < this.idleMs) continue
      const room = this.rooms.get(id)
      if (room && room.size === 0) {
        room.flush()
        this.rooms.delete(id)
      }
      this.idleSince.delete(id)
    }
  }

  flushAll(): void {
    for (const room of this.rooms.values()) room.flush()
  }
}
