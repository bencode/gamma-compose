import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourceCodeViewer } from './source-code-viewer'

describe('SourceCodeViewer', () => {
  it('renders highlighted, focusable source without allowing edits', async () => {
    const { container, rerender } = render(
      <SourceCodeViewer path="src/app.tsx" value="export const App = () => <h1>Hello</h1>" />,
    )

    const viewer = await screen.findByRole('textbox', { name: 'src/app.tsx' })
    expect(viewer).toHaveAttribute('aria-readonly', 'true')
    expect(viewer).toHaveAttribute('contenteditable', 'false')
    expect(viewer).toHaveAttribute('tabindex', '0')
    expect(viewer).toHaveTextContent('Hello')
    expect(container.querySelector('.cm-lineNumbers')).toHaveTextContent('1')
    expect(container.querySelector('.cm-line span')).not.toBeNull()

    rerender(
      <SourceCodeViewer path="src/app.tsx" value="export const App = () => <h1>Updated</h1>" />,
    )
    await waitFor(() => expect(viewer).toHaveTextContent('Updated'))
  })

  it('renders unknown file types as plain text', async () => {
    const { container } = render(
      <SourceCodeViewer path="notes.txt" value="Plain text remains readable." />,
    )

    expect(await screen.findByRole('textbox', { name: 'notes.txt' })).toHaveTextContent(
      'Plain text remains readable.',
    )
    expect(container.querySelector('.cm-line span')).toBeNull()
  })

  it('highlights JSON files', async () => {
    const { container } = render(<SourceCodeViewer path="data.json" value={'{"enabled": true}'} />)

    expect(await screen.findByRole('textbox', { name: 'data.json' })).toHaveTextContent('enabled')
    expect(container.querySelector('.cm-line span')).not.toBeNull()
  })
})
