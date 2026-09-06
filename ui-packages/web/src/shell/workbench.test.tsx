import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoFiles } from '../core/project/demo-project'
import { Workbench } from './workbench'

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
    String(input) === '/api/agent/config'
      ? Response.json({ enabled: false })
      : new Response(JSON.stringify({ ok: true, js: 'export {}', css: '', warnings: [] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
  )
})
afterEach(() => vi.restoreAllMocks())

describe('workbench', () => {
  it('shows the selected file as read-only source', async () => {
    const user = userEvent.setup()
    render(<Workbench />)

    expect(screen.getByRole('region', { name: 'Conversation' })).toBeEmptyDOMElement()
    expect(await screen.findByTitle('Project preview')).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'Output view' }))
    await user.click(tabs.getByRole('tab', { name: 'Files' }))
    const files = within(screen.getByRole('region', { name: 'File browser' }))
    const source = screen.getByRole('region', { name: 'Source code' })
    const code = within(source).getByRole('textbox')
    expect(within(source).getByRole('heading')).toHaveTextContent('src/app.tsx')
    expect(code).toHaveValue(demoFiles['src/app.tsx'])
    expect(code).toHaveAttribute('readonly')
    expect(source.querySelector('table')).toBeNull()

    await user.click(files.getByRole('button', { name: 'styles.css' }))
    expect(within(source).getByRole('heading')).toHaveTextContent('src/styles.css')
    expect(within(source).getByRole('textbox')).toHaveValue(demoFiles['src/styles.css'])
  })

  it('preserves draft, file selection, directories and preview across tabs', async () => {
    const user = userEvent.setup()
    render(<Workbench />)
    const frame = await screen.findByTitle('Project preview')
    const draft = screen.getByRole('textbox', { name: 'Message' })
    const tabs = within(screen.getByRole('tablist', { name: 'Output view' }))

    await user.click(draft)
    await user.paste('A team workspace')
    await user.click(tabs.getByRole('tab', { name: 'Files' }))
    const files = within(screen.getByRole('region', { name: 'File browser' }))
    await user.click(files.getByRole('button', { name: 'styles.css' }))
    await user.click(files.getByRole('button', { name: 'src' }))
    await user.click(tabs.getByRole('tab', { name: 'Preview' }))
    expect(screen.queryByRole('region', { name: 'File browser' })).not.toBeInTheDocument()
    await user.click(tabs.getByRole('tab', { name: 'Files' }))

    expect(screen.getByTitle('Project preview')).toBe(frame)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(draft).toHaveValue('A team workspace')
    const visibleFiles = within(screen.getByRole('region', { name: 'File browser' }))
    expect(visibleFiles.getByRole('button', { name: 'src' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('heading', { name: 'src/styles.css' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled()
    await user.click(visibleFiles.getByRole('button', { name: 'src' }))
    expect(visibleFiles.getByRole('button', { name: 'styles.css' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('retains a live conversation across tabs and responsive panel remounts', async () => {
    let desktop = false
    const listeners = new Set<() => void>()
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: desktop,
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: EventListenerOrEventListenerObject | null) => {
        if (typeof listener === 'function') listeners.add(listener as () => void)
      },
      removeEventListener: (
        _event: string,
        listener: EventListenerOrEventListenerObject | null,
      ) => {
        if (typeof listener === 'function') listeners.delete(listener as () => void)
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    vi.mocked(fetch).mockImplementation(async input => {
      if (String(input) === '/api/agent/config')
        return Response.json({ enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' })
      if (String(input).endsWith('/chat/completions')) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      return Response.json({ ok: true, js: 'export {}', css: '', warnings: [] })
    })
    render(<Workbench />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Build a page' },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(stream).toBeDefined())
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
    act(() => {
      desktop = true
      listeners.forEach(notify => {
        notify()
      })
    })
    expect(screen.getByRole('article', { name: 'You' })).toHaveTextContent('Build a page')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    act(() => {
      stream?.enqueue(
        new TextEncoder().encode(
          'data: {"choices":[{"index":0,"delta":{"content":"Let us discuss it."},"finish_reason":"stop"}]}\n\n',
        ),
      )
      stream?.close()
    })
    expect(await screen.findByText('Let us discuss it.')).toBeInTheDocument()
    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/chat/completions')),
    ).toHaveLength(1)
  })
})
