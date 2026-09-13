import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openProjectDatabase } from '../core/project/database'
import { App } from './app'

const compiled = {
  ok: true,
  build: {
    projectId: 'test-project',
    buildId: 'a'.repeat(64),
    compilerVersion: '1',
    entry: 'src/main.tsx',
    files: {},
    previewUrl: '/__preview/test-project/1',
  },
  warnings: [],
}
const missingTree = () =>
  Response.json({ ok: false, reason: 'not-found', error: { message: 'Missing' } }, { status: 404 })

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  window.history.replaceState(null, '', '/')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url === '/api/agent/config') return Response.json({ enabled: false })
    if (url.endsWith('/tree')) return missingTree()
    return Response.json(compiled)
  })
})
afterEach(() => vi.restoreAllMocks())

const configureWriter = (contents: string[]) => {
  let request = 0
  vi.mocked(fetch).mockImplementation(async input => {
    if (String(input) === '/api/agent/config')
      return Response.json({ enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' })
    if (String(input).endsWith('/tree')) return missingTree()
    if (String(input).endsWith('/builds')) return Response.json(compiled)
    const content = contents[request++]
    const delta =
      content === undefined
        ? { content: 'Done.' }
        : {
            tool_calls: [
              {
                index: 0,
                id: `write-${request}`,
                type: 'function',
                function: {
                  name: 'write',
                  arguments: JSON.stringify({ path: 'src/app.tsx', content }),
                },
              },
            ],
          }
    return new Response(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: content === undefined ? 'stop' : 'tool_calls' }] })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  })
}

const sendChange = async () => {
  const input = screen.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, {
    target: { value: 'Update the page' },
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('Done.')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull())
}

const sendText = async (text: string) => {
  const input = screen.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: text } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('Done.')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull())
}

describe('gallery and project navigation', () => {
  it('creates from a template, restores its chat and files, and isolates another project', async () => {
    const user = userEvent.setup()
    const updated = 'export const App = () => <h1>Saved change</h1>'
    configureWriter(['export const App = () => <h1>First change</h1>', updated])
    const first = render(<App />)
    expect(await screen.findByRole('button', { name: 'Start with Blank' })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /^Start with / })).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Start with Blank' }))
    await screen.findByTitle('Project preview')
    const projectPath = window.location.pathname
    expect(projectPath).toMatch(/^\/projects\/.+/)
    await sendChange()
    const projectId = projectPath.split('/').at(-1) as string
    await waitFor(async () => {
      const database = await openProjectDatabase()
      try {
        expect((await database.getProject(projectId))?.files['src/app.tsx']).toBe(updated)
      } finally {
        database.close()
      }
    })
    await user.click(screen.getByRole('tab', { name: 'Repository' }))
    expect(await screen.findByRole('textbox', { name: 'src/app.tsx' })).toHaveTextContent(updated)
    first.unmount()

    render(<App />)
    await screen.findByTitle('Project preview')
    const conversation = screen.getByRole('region', { name: 'Conversation' })
    await waitFor(() => expect(conversation).toHaveTextContent('Update the page'))
    expect(conversation).toHaveTextContent('Done.')
    await user.click(screen.getByRole('tab', { name: 'Repository' }))
    expect(await screen.findByRole('textbox', { name: 'src/app.tsx' })).toHaveTextContent(updated)
    await user.click(screen.getByRole('link', { name: 'Back to gallery' }))
    const projects = await screen.findByRole('region', { name: 'My projects' })
    await waitFor(() => expect(within(projects).getAllByRole('link')).toHaveLength(1))
    await user.click(within(projects).getByRole('link'))
    await screen.findByTitle('Project preview')
    expect(window.location.pathname).toBe(projectPath)
    await user.click(screen.getByRole('link', { name: 'Back to gallery' }))
    await user.click(await screen.findByRole('button', { name: 'Start with Blank' }))
    await screen.findByTitle('Project preview')
    expect(window.location.pathname).not.toBe(projectPath)
    await user.click(screen.getByRole('tab', { name: 'Repository' }))
    expect(screen.getByRole('textbox', { name: 'src/app.tsx' })).not.toHaveValue(updated)
  })

  it('confirms project deletion, supports cancellation and shows the empty state', async () => {
    const user = userEvent.setup()
    const database = await openProjectDatabase()
    const first = await database.createProject('blank')
    const second = await database.createProject('blank')
    await database.saveProject({ ...first, name: 'First project' })
    await database.saveProject({ ...second, name: 'Second project' })
    database.close()
    render(<App />)
    const projects = await screen.findByRole('region', { name: 'My projects' })

    await user.click(within(projects).getByRole('button', { name: 'Delete First project' }))
    const firstDialog = screen.getByRole('dialog', { name: 'Delete project?' })
    expect(firstDialog).toHaveTextContent('First project')
    expect(firstDialog).toHaveTextContent('files, chats, app data, and preview state')
    await user.click(within(firstDialog).getByRole('button', { name: 'Cancel' }))
    expect(within(projects).getByRole('link', { name: /First project/ })).toBeInTheDocument()

    await user.click(within(projects).getByRole('button', { name: 'Delete First project' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete project?' })).getByRole('button', {
        name: 'Delete project',
      }),
    )
    await waitFor(() =>
      expect(within(projects).queryByRole('link', { name: /First project/ })).toBeNull(),
    )
    expect(within(projects).getByRole('link', { name: /Second project/ })).toBeInTheDocument()

    await user.click(within(projects).getByRole('button', { name: 'Delete Second project' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete project?' })).getByRole('button', {
        name: 'Delete project',
      }),
    )
    expect(
      await within(projects).findByText('Nothing here yet. Start with a template above.'),
    ).toBeInTheDocument()
    const reopened = await openProjectDatabase()
    expect(await reopened.listProjects()).toEqual([])
    reopened.close()
  })

  it('creates, switches, and deletes independent chats for one project', async () => {
    const user = userEvent.setup()
    configureWriter([])
    const database = await openProjectDatabase()
    const project = await database.createProject('blank')
    database.close()
    window.history.replaceState(null, '', `/projects/${project.id}`)
    render(<App />)
    await screen.findByTitle('Project preview')

    await sendText('First idea')
    await user.click(screen.getByRole('button', { name: 'Chats' }))
    const chats = screen.getByRole('dialog', { name: 'Chats' })
    await user.click(within(chats).getByRole('button', { name: 'New chat' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Conversation' })).toBeEmptyDOMElement(),
    )
    await sendText('Second idea')

    await user.click(screen.getByRole('button', { name: 'Chats' }))
    await user.click(within(chats).getByRole('button', { name: 'First idea' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Conversation' })).toHaveTextContent('First idea'),
    )
    expect(screen.getByRole('region', { name: 'Conversation' })).not.toHaveTextContent(
      'Second idea',
    )

    await user.click(screen.getByRole('button', { name: 'Chats' }))
    await user.click(within(chats).getByRole('button', { name: 'Delete chat: Second idea' }))
    await user.click(within(chats).getByRole('button', { name: 'Delete chat' }))
    await waitFor(() =>
      expect(within(chats).queryByRole('button', { name: 'Second idea' })).toBeNull(),
    )
    const reopened = await openProjectDatabase()
    expect((await reopened.listChatSessions(project.id)).map(session => session.title)).toEqual([
      'First idea',
    ])
    reopened.close()
  })

  it('reopens saved files at the size limit without counting project metadata', async () => {
    const database = await openProjectDatabase()
    const project = await database.createProject('blank')
    const snapshot = { entry: project.entry, files: { [project.entry]: '' } }
    const overhead = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
    snapshot.files[project.entry] = `//${'x'.repeat(16 * 1024 * 1024 - overhead - 2)}`
    try {
      await database.saveProject({ ...project, ...snapshot })
    } finally {
      database.close()
    }
    window.history.replaceState(null, '', `/projects/${project.id}`)
    render(<App />)
    expect(await screen.findByTitle('Project preview')).toBeInTheDocument()
    const compileRequest = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/builds'))
    expect(JSON.parse(String(compileRequest?.[1]?.body))).toMatchObject({
      baseBuildId: null,
      entry: snapshot.entry,
      changes: snapshot.files,
    })
  })

  it('shows save failure and retries the latest in-memory files', async () => {
    const user = userEvent.setup()
    configureWriter(['export const App = () => <h1>Retry me</h1>'])
    const database = await openProjectDatabase()
    const project = await database.createProject('blank')
    window.history.replaceState(null, '', `/projects/${project.id}`)
    const warning = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)
    await screen.findByTitle('Project preview')
    const originalPut = IDBObjectStore.prototype.put
    let failed = false
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function put(
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (this.name === 'projects' && !failed) {
        failed = true
        throw new DOMException('Storage full', 'QuotaExceededError')
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
    })
    await sendChange()
    expect(
      await screen.findByRole('button', { name: 'Save failed. Retry save' }),
    ).toBeInTheDocument()
    expect((await database.getProject(project.id))?.files).toEqual(project.files)
    expect(warning).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save failed. Retry save' }))
    await waitFor(async () =>
      expect((await database.getProject(project.id))?.files['src/app.tsx']).toContain('Retry me'),
    )
    database.close()
  })

  it('blocks chat after a transcript write failure and retries before sending', async () => {
    const user = userEvent.setup()
    configureWriter([])
    const database = await openProjectDatabase()
    const project = await database.createProject('blank')
    database.close()
    window.history.replaceState(null, '', `/projects/${project.id}`)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)
    await screen.findByTitle('Project preview')
    const originalPut = IDBObjectStore.prototype.put
    let failed = false
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function put(
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (this.name === 'sessions' && !failed) {
        failed = true
        throw new DOMException('Storage full', 'QuotaExceededError')
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
    })

    const input = screen.getByRole('textbox', { name: 'Message' })
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'Keep this request' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const retry = await screen.findByRole('button', { name: 'Chat save failed · Retry' })
    expect(input).toBeDisabled()
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/chat/completions')),
    ).toHaveLength(0)
    expect(error).toHaveBeenCalled()

    await user.click(retry)
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Done.')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull())
  })

  it('reports a missing local project without creating a replacement', async () => {
    window.history.replaceState(null, '', '/projects/missing')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
    const database = await openProjectDatabase()
    expect(await database.listProjects()).toEqual([])
    database.close()
  })

  it('allows retry after a database read failure', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage disabled')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Start with Blank' })).toBeEnabled()
  })
})
