import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoFiles, demoProject } from '../core/project/demo-project'
import { createProjectStore } from '../core/project/store'
import { Workbench as WorkbenchView } from './workbench'

const Workbench = () => {
  const [project] = useState(() => createProjectStore(demoProject))
  return (
    <MemoryRouter>
      <WorkbenchView
        projectId="test-project"
        project={project}
        projectName="Team workspace"
        saveStatus="saved"
        onRetrySave={() => undefined}
      />
    </MemoryRouter>
  )
}

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

describe('desktop layout persistence', () => {
  const storageKey = 'react-resizable-panels:gamma-compose-workbench-desktop'
  let desktop = true
  const listeners = new Set<() => void>()
  const conversationPanel = () =>
    screen
      .getByRole('complementary', { name: 'Conversation workspace' })
      .closest<HTMLElement>('[data-panel]')

  beforeEach(() => {
    desktop = true
    listeners.clear()
    localStorage.removeItem(storageKey)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400)
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: desktop,
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') listeners.add(listener as () => void)
      },
      removeEventListener: (_: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') listeners.delete(listener as () => void)
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })
  afterEach(() => localStorage.removeItem(storageKey))

  it('saves user resizing, restores it on remount, and isolates mobile layouts', async () => {
    const first = render(<Workbench />)
    await screen.findByTitle('Project preview')
    expect(conversationPanel()).toHaveStyle({ flexGrow: '36' })
    expect(localStorage.getItem(storageKey)).toBeNull()
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    await waitFor(() => expect(localStorage.getItem(storageKey)).not.toBeNull())
    const saved = localStorage.getItem(storageKey)
    const proportion = conversationPanel()?.style.flexGrow
    expect(Number(proportion)).toBeGreaterThan(36)
    first.unmount()

    render(<Workbench />)
    await screen.findByTitle('Project preview')
    expect(conversationPanel()).toHaveStyle({ flexGrow: proportion })
    act(() => {
      desktop = false
      listeners.forEach(notify => {
        notify()
      })
    })
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(conversationPanel()).toHaveStyle({ flexGrow: '40' })
    expect(localStorage.getItem(storageKey)).toBe(saved)
    act(() => {
      desktop = true
      listeners.forEach(notify => {
        notify()
      })
    })
    expect(conversationPanel()).toHaveStyle({ flexGrow: proportion })
    expect(localStorage.getItem(storageKey)).toBe(saved)
  })

  it.each(['{broken', 'null', '{"conversation":-20,"output":120}'])(
    'uses the default layout when saved data is invalid: %s',
    async saved => {
      localStorage.setItem(storageKey, saved)
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      render(<Workbench />)
      await screen.findByTitle('Project preview')
      expect(conversationPanel()).toHaveStyle({ flexGrow: '36' })
      expect(warning).toHaveBeenCalled()
    },
  )

  it.each([
    ['getItem', 'SecurityError'],
    ['setItem', 'QuotaExceededError'],
  ] as const)('keeps resizing usable when storage %s fails', async (method, name) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException('Storage unavailable', name)
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<Workbench />)
    await screen.findByTitle('Project preview')
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    await waitFor(() => expect(Number(conversationPanel()?.style.flexGrow)).toBeGreaterThan(36))
    expect(warning).toHaveBeenCalled()
  })
})

describe('workbench', () => {
  it('updates the file panel from Agent writes and compiles only on an explicit tool call', async () => {
    const user = userEvent.setup()
    let modelRequests = 0
    let finish: ReadableStreamDefaultController<Uint8Array> | undefined
    const compileInputs: string[] = []
    const updated = 'export const App = () => <h1>Updated project</h1>'
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/agent/config')
        return Response.json({ enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' })
      if (String(input) === '/api/compile') {
        compileInputs.push(String(init?.body))
        return Response.json({ ok: true, js: 'export {}', css: '', warnings: [] })
      }
      modelRequests += 1
      if (modelRequests === 1)
        return new Response(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'update', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: 'src/app.tsx', content: updated }) } }] }, finish_reason: 'tool_calls' }] })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      if (modelRequests === 2)
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              finish = controller
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      if (modelRequests === 3)
        return new Response(
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"refresh","type":"function","function":{"name":"refresh_preview","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      return new Response(
        'data: {"choices":[{"index":0,"delta":{"content":"Compiled."},"finish_reason":"stop"}]}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    })
    render(<Workbench />)
    const frame = await screen.findByTitle('Project preview')
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Update the page' },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(finish).toBeDefined())
    await user.click(screen.getByRole('tab', { name: 'Files' }))
    expect(screen.getByRole('textbox', { name: 'src/app.tsx' })).toHaveValue(updated)
    expect(compileInputs).toHaveLength(1)
    expect(screen.getByTitle('Project preview')).toBe(frame)
    act(() => {
      finish?.enqueue(
        new TextEncoder().encode(
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"compile","type":"function","function":{"name":"compile","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        ),
      )
      finish?.close()
    })
    await waitFor(() => expect(screen.getByTitle('Project preview')).not.toBe(frame))
    const refreshedFrame = screen.getByTitle<HTMLIFrameElement>('Project preview')
    act(() => {
      fireEvent(
        window,
        new MessageEvent('message', {
          source: refreshedFrame.contentWindow,
          data: { type: 'preview:loaded' },
        }),
      )
    })
    await screen.findByText('Compiled.', undefined, { timeout: 2_000 })
    expect(compileInputs).toHaveLength(2)
    expect(JSON.parse(compileInputs[1] ?? '{}').files['src/app.tsx']).toBe(updated)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTitle('Project preview')).toBe(refreshedFrame)
    expect(modelRequests).toBe(4)
  })

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
