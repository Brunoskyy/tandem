/**
 * Fractional ordering: an item's position is a number, and inserting between
 * two neighbours takes the midpoint. Nobody else's position has to change,
 * which is what keeps a drag from conflicting with a drag somewhere else in
 * the same column.
 *
 * Doubles run out of room after ~50 inserts into the same gap; `needsRebalance`
 * tells the client when to spread a column back out.
 */
export const ORDER_STEP = 1024

export function between(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return (after as number) - ORDER_STEP
  if (after === undefined) return before + ORDER_STEP
  return (before + after) / 2
}

export function needsRebalance(before: number | undefined, after: number | undefined): boolean {
  if (before === undefined || after === undefined) return false
  return after - before < 1e-6
}

/** Positions that spread `count` items evenly, for a rebalance. */
export function spread(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i * ORDER_STEP)
}

export function sortByOrder<T extends { order: number; id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
}
