import {
  between,
  needsRebalance,
  sortByOrder,
  spread,
  type Note,
  type OpBody,
} from '@tandem/shared'

/** Index at which a card dropped at `y` lands, given the other cards' vertical midpoints. */
export function dropIndex(midpoints: readonly number[], y: number): number {
  let i = 0
  while (i < midpoints.length && (midpoints[i] as number) < y) i += 1
  return i
}

/**
 * The ops that put `noteId` at `index` in `columnId`. Usually one move; when
 * the gap between neighbours has run out of precision, the whole column is
 * spread back out first, which is a few extra tiny ops rather than a bug
 * someone hits on the fiftieth drag.
 */
export function moveOps(
  notes: readonly Note[],
  noteId: string,
  columnId: string,
  index: number,
): OpBody[] {
  const column = sortByOrder(notes.filter((n) => n.columnId === columnId && n.id !== noteId))
  const before = column[index - 1]?.order
  const after = column[index]?.order
  if (!needsRebalance(before, after)) {
    return [{ kind: 'note.move', id: noteId, columnId, order: between(before, after) }]
  }
  const positions = spread(column.length + 1)
  const ops: OpBody[] = []
  column.forEach((n, i) => {
    const order = positions[i < index ? i : i + 1] as number
    ops.push({ kind: 'note.move', id: n.id, columnId, order })
  })
  ops.push({ kind: 'note.move', id: noteId, columnId, order: positions[index] as number })
  return ops
}
