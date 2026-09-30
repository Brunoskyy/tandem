import type { BoardState, Column, Id } from './types.ts'
import { ORDER_STEP } from './order.ts'

export interface Template {
  key: string
  name: string
  columns: string[]
}

export const TEMPLATES: readonly Template[] = [
  { key: 'retro', name: 'Retrospective', columns: ['Went well', 'To improve', 'Action items'] },
  { key: 'starfish', name: 'Starfish', columns: ['Keep', 'More of', 'Less of', 'Start', 'Stop'] },
  { key: 'brainstorm', name: 'Brainstorm', columns: ['Ideas', 'Questions', 'Parking lot'] },
  { key: 'blank', name: 'Blank', columns: ['Column'] },
]

export function newBoard(id: Id, title: string, template: Template, makeId: () => Id): BoardState {
  const columns: Record<Id, Column> = {}
  template.columns.forEach((t, i) => {
    const cid = makeId()
    columns[cid] = { id: cid, title: t, order: i * ORDER_STEP }
  })
  return { id, title, phase: 'write', votesPerPerson: 3, columns, notes: {} }
}
