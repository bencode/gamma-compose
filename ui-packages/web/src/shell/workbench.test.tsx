import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../core/project/demo-project'
import { createProjectRepository } from '../core/project/repository'
import { createProjectStore } from '../core/project/store'
import { Workbench as WorkbenchView } from './workbench'

const compiled = (previewUrl = '/__preview/test-project/1') => ({
  ok: true,
  build: {
    projectId: 'test-project',
    buildId: 'a'.repeat(64),
    compilerVersion: '1',
    entry: demoProject.entry,
    files: {},
    previewUrl,
  },
  warnings: [],
})
const missingTree = () =>
  Response.json({ ok: false, reason: 'not-found', error: { message: 'Missing' } }, { status: 404 })

type TestWorkbenchProps = {
  attachment?: 'source' | 'stored'
  deleteStoredFile?: (id: string) => Promise<void>
}

const Workbench = ({
  attachment,
  deleteStoredFile = async () => undefined,
}: TestWorkbenchProps) => {
  const [project] = useState(() => {
    const store = createProjectStore(demoProject)
    if (attachment === 'source') store.writeFile('attachments/generated.md', '# Generated')
    return store
  })
  const [repository] = useState(() =>
    createProjectRepository(
      'test-project',
      project,
      {
        getStoredFileContent: async id =>
          id === 'stored-reference' ? new Blob(['# Stored']) : undefined,
        saveStoredFiles: async () => undefined,
        deleteStoredFile,
      },
      attachment === 'stored'
        ? [
            {
              id: 'stored-reference',
              projectId: 'test-project',
              path: 'attachments/reference.md',
              mediaType: 'text/markdown',
              size: 8,
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
            },
          ]
        : [],
    ),
  )
  return (
    <MemoryRouter>
      <WorkbenchView
        projectId="test-project"
        project={project}
        repository={repository}
        projectName="Team workspace"
        saveStatus="saved"
        onRetrySave={() => undefined}
        compilePersistence={{ load: async () => undefined, save: async () => undefined }}
      />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url === '/api/agent/config') return Response.json({ enabled: false })
    if (url.endsWith('/tree')) return missingTree()
    return Response.json(compiled())
  })
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
      if (String(input).endsWith('/builds')) {
        compileInputs.push(String(init?.body))
        return Response.json(compiled())
      }
      if (String(input).endsWith('/tree')) return missingTree()
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
    await user.click(screen.getByRole('tab', { name: 'Repository' }))
    expect(await screen.findByRole('textbox', { name: 'src/app.tsx' })).toHaveTextContent(updated)
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
    expect(JSON.parse(compileInputs[1] ?? '{}').changes['src/app.tsx']).toBe(updated)
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
    await user.click(tabs.getByRole('tab', { name: 'Repository' }))
    const files = within(screen.getByRole('region', { name: 'Repository browser' }))
    const source = screen.getByRole('region', { name: 'Repository preview' })
    const code = await within(source).findByRole('textbox', { name: 'src/app.tsx' })
    expect(within(source).getByRole('heading')).toHaveTextContent('src/app.tsx')
    expect(code).toHaveTextContent('Team workspace')
    expect(code).toHaveAttribute('aria-readonly', 'true')
    expect(code).toHaveAttribute('contenteditable', 'false')
    expect(source.querySelector('.cm-lineNumbers')).toBeInTheDocument()
    expect(source.querySelector('table')).toBeNull()
    expect(within(source).queryByRole('button', { name: 'Attach to message' })).toBeNull()
    await user.click(files.getByRole('button', { name: 'Attach src/app.tsx to message' }))
    expect(screen.getByRole('list', { name: 'Attachments' })).toHaveTextContent('app.tsx')

    await user.click(files.getByRole('button', { name: 'styles.css' }))
    expect(within(source).getByRole('heading')).toHaveTextContent('src/styles.css')
    expect(
      await within(source).findByRole('textbox', { name: 'src/styles.css' }),
    ).toHaveTextContent('text-wrap: balance')

    await user.click(files.getByRole('button', { name: 'README.md' }))
    expect(await within(source).findByTestId('markdown-content')).toHaveTextContent(
      'Team workspace',
    )
    await user.click(files.getByRole('button', { name: 'Attach README.md to message' }))
    expect(screen.getByRole('list', { name: 'Attachments' })).toHaveTextContent('README.md')
  })

  it('confirms attachment deletion inline and updates selection and the draft', async () => {
    const user = userEvent.setup()
    render(<Workbench attachment="source" />)
    await screen.findByTitle('Project preview')
    await user.click(screen.getByRole('tab', { name: 'Repository' }))
    const files = within(screen.getByRole('region', { name: 'Repository browser' }))

    await user.click(files.getByRole('button', { name: 'generated.md' }))
    await user.click(
      files.getByRole('button', { name: 'Attach attachments/generated.md to message' }),
    )
    expect(screen.getByRole('list', { name: 'Attachments' })).toHaveTextContent('generated.md')

    await user.click(files.getByRole('button', { name: 'Delete attachments/generated.md' }))
    await user.click(
      files.getByRole('button', { name: 'Cancel deleting attachments/generated.md' }),
    )
    expect(files.getByRole('button', { name: 'generated.md' })).toBeInTheDocument()

    await user.click(files.getByRole('button', { name: 'Delete attachments/generated.md' }))
    await user.click(files.getByRole('button', { name: 'Confirm delete attachments/generated.md' }))
    await waitFor(() =>
      expect(files.queryByRole('button', { name: 'generated.md' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'src/main.tsx' })).toBeInTheDocument()
  })

  it('keeps an attachment available when deletion fails', async () => {
    const user = userEvent.setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <Workbench
        attachment="stored"
        deleteStoredFile={async () => {
          throw new Error('Storage failed')
        }}
      />,
    )
    await screen.findByTitle('Project preview')
    await user.click(screen.getByRole('tab', { name: 'Repository' }))
    const files = within(screen.getByRole('region', { name: 'Repository browser' }))

    await user.click(files.getByRole('button', { name: 'Delete attachments/reference.md' }))
    await user.click(files.getByRole('button', { name: 'Confirm delete attachments/reference.md' }))
    expect(await files.findByRole('alert')).toHaveTextContent('Storage failed')
    expect(files.getByRole('button', { name: 'reference.md' })).toBeInTheDocument()
    expect(error).toHaveBeenCalled()
  })

  it('preserves draft, file selection, directories and preview across tabs', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation(async input => {
      const url = String(input)
      if (url === '/api/agent/config')
        return Response.json({ enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' })
      if (url.endsWith('/tree')) return missingTree()
      return Response.json(compiled())
    })
    render(<Workbench />)
    const frame = await screen.findByTitle('Project preview')
    const draft = screen.getByRole('textbox', { name: 'Message' })
    const tabs = within(screen.getByRole('tablist', { name: 'Output view' }))

    await user.click(draft)
    await user.paste('A team workspace')
    await user.click(tabs.getByRole('tab', { name: 'Repository' }))
    const files = within(screen.getByRole('region', { name: 'Repository browser' }))
    await user.click(files.getByRole('button', { name: 'styles.css' }))
    await user.click(files.getByRole('button', { name: 'src' }))
    await user.click(tabs.getByRole('tab', { name: 'Preview' }))
    expect(screen.queryByRole('region', { name: 'Repository browser' })).not.toBeInTheDocument()
    await user.click(tabs.getByRole('tab', { name: 'Repository' }))

    expect(screen.getByTitle('Project preview')).toBe(frame)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(draft).toHaveValue('A team workspace')
    const visibleFiles = within(screen.getByRole('region', { name: 'Repository browser' }))
    expect(visibleFiles.getByRole('button', { name: 'src' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('heading', { name: 'src/styles.css' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Send/ })).toBeEnabled()
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
      if (String(input).endsWith('/tree')) return missingTree()
      return Response.json(compiled())
    })
    render(<Workbench />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Build a page' },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(stream).toBeDefined())
    fireEvent.click(screen.getByRole('tab', { name: 'Repository' }))
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
