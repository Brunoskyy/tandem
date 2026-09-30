import { describe, expect, it } from 'vitest'

import { between, needsRebalance, ORDER_STEP, sortByOrder, spread } from '../src/order.ts'

describe('fractional order', () => {
  it('places at ends and between', () => {
    expect(between(undefined, undefined)).toBe(0)
    expect(between(undefined, 0)).toBe(-ORDER_STEP)
    expect(between(0, undefined)).toBe(ORDER_STEP)
    expect(between(0, ORDER_STEP)).toBe(ORDER_STEP / 2)
  })

  it('knows when a gap is exhausted', () => {
    let lo = 0
    let hi = ORDER_STEP
    let i = 0
    while (!needsRebalance(lo, hi)) {
      hi = between(lo, hi)
      i += 1
      if (i > 200) break
    }
    expect(i).toBeGreaterThan(20)
    expect(i).toBeLessThan(200)
    expect(spread(3)).toEqual([0, ORDER_STEP, 2 * ORDER_STEP])
  })

  it('sorts stably with id as the tiebreak', () => {
    const items = [
      { id: 'b', order: 1 },
      { id: 'a', order: 1 },
      { id: 'c', order: 0 },
    ]
    expect(sortByOrder(items).map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })
})
