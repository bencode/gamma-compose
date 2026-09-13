import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ActivityGroup, ProcessItem } from './conversation-transcript'
import { summarizeActivity } from './conversation-transcript'

const preview = (text: string, maximum = 72) => {
  const line = text
    .split('\n')
    .find(value => value.trim())
    ?.trim()
  if (!line) return ''
  return line.length > maximum ? `${line.slice(0, maximum)}…` : line
}

const inputSummary = (input: unknown) => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ''
  if ('path' in input && typeof input.path === 'string') return input.path
  if ('resource' in input && typeof input.resource === 'string') {
    const id = 'id' in input && typeof input.id === 'string' ? ` · ${input.id}` : ''
    return `${input.resource}${id}`
  }
  return ''
}

const formattedInput = (input: unknown) => {
  if (input === undefined) return undefined
  try {
    return JSON.stringify(input, null, 2)
  } catch (error) {
    console.error('Could not format tool input.', error)
    return String(input)
  }
}

export const ActivityStep = ({ item }: { item: ProcessItem }) => {
  const [open, setOpen] = useState(false)
  const thinking = item.kind === 'thinking'
  const label = thinking ? 'Thinking' : item.name
  const summary = thinking ? preview(item.text) : inputSummary(item.input)
  const input = thinking ? undefined : formattedInput(item.input)

  return (
    <div className="activity-step" data-kind={item.kind}>
      <button
        type="button"
        className="activity-step-trigger"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <ChevronRight className="activity-chevron" aria-hidden="true" size={13} />
        <span className="activity-step-name">{label}</span>
        {summary && <span className="activity-step-summary">{summary}</span>}
        {!thinking && (
          <span className="activity-step-status" data-status={item.status}>
            {item.status}
          </span>
        )}
      </button>
      {open && (
        <div className="activity-detail">
          {thinking ? (
            <p>{item.text}</p>
          ) : (
            <>
              {input !== undefined && (
                <section>
                  <h3>Input</h3>
                  <pre>{input}</pre>
                </section>
              )}
              {item.output !== undefined && (
                <section>
                  <h3>Output</h3>
                  <pre>{item.output}</pre>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export const ActivityBlock = ({ group }: { group: ActivityGroup }) => {
  const [choice, setChoice] = useState<boolean | null>(null)
  const open = choice ?? group.live
  const { steps, parts, failed } = summarizeActivity(group)

  return (
    <div className="activity-group" data-live={group.live}>
      <button
        type="button"
        className="activity-group-trigger"
        aria-expanded={open}
        onClick={() => setChoice(!open)}
      >
        <ChevronRight className="activity-chevron" aria-hidden="true" size={13} />
        <span>{steps === 1 ? '1 step' : `${steps} steps`}</span>
        {parts.map(part => (
          <span className="activity-summary-part" key={part}>
            {part}
          </span>
        ))}
        {failed > 0 && <span className="activity-failed">{failed} failed</span>}
        {group.live && <span className="activity-running">Running</span>}
      </button>
      {open && (
        <div className="activity-steps">
          {group.items.map(item => (
            <ActivityStep item={item} key={item.key} />
          ))}
        </div>
      )}
    </div>
  )
}
