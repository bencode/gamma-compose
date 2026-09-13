import type { ConversationItem, ProcessItem } from './conversation-transcript'

export type ActivityGroup = {
  kind: 'activity-group'
  key: string
  items: ProcessItem[]
  live: boolean
}

export type ConversationStreamItem = ConversationItem | ActivityGroup

const isProcess = (item: ConversationItem): item is ProcessItem =>
  item.kind === 'thinking' || item.kind === 'tool'

export const groupConversationActivity = (
  items: readonly ConversationItem[],
  running: boolean,
): ConversationStreamItem[] => {
  const stream: ConversationStreamItem[] = []
  let pending: ProcessItem[] = []
  const flush = (live: boolean) => {
    if (pending.length === 0) return
    if (pending.length === 1 && !live && pending[0]) stream.push(pending[0])
    else
      stream.push({
        kind: 'activity-group',
        key: `activity:${pending[0]?.key}`,
        items: pending,
        live,
      })
    pending = []
  }

  items.forEach(item => {
    if (isProcess(item)) pending.push(item)
    else {
      flush(false)
      stream.push(item)
    }
  })
  flush(running)
  return stream
}

export const summarizeActivity = (group: ActivityGroup) => {
  const counts = new Map<string, number>()
  group.items.forEach(item => {
    const label = item.kind === 'thinking' ? 'thinking' : item.name
    counts.set(label, (counts.get(label) ?? 0) + 1)
  })
  const thinking = counts.get('thinking')
  counts.delete('thinking')
  const parts = [...counts].map(([name, count]) => `${count} ${name}`)
  if (thinking !== undefined) parts.push(`${thinking} thinking`)
  return {
    steps: group.items.length,
    parts,
    failed: group.items.filter(item => item.kind === 'tool' && item.failed).length,
  }
}
