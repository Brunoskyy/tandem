import { sortByOrder, type BoardState } from '@tandem/shared'

/** Markdown export: one heading per column, notes as bullets with their vote count. */
export function toMarkdown(state: BoardState): string {
  const lines = [`# ${state.title}`, '']
  for (const column of sortByOrder(Object.values(state.columns))) {
    lines.push(`## ${column.title}`, '')
    const notes = sortByOrder(Object.values(state.notes).filter((n) => n.columnId === column.id))
    const ranked = [...notes].sort(
      (a, b) => Object.keys(b.votes).length - Object.keys(a.votes).length,
    )
    if (ranked.length === 0) lines.push('_Nothing here._')
    for (const note of ranked) {
      const votes = Object.keys(note.votes).length
      const text = note.text.trim().replace(/\r?\n/g, ' ') || '_(empty)_'
      lines.push(`- ${text}${votes ? ` (${votes} vote${votes === 1 ? '' : 's'})` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
