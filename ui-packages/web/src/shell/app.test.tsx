import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openProjectDatabase } from '../core/project/database'
import { App } from './app'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  window.history.replaceState(null, '', '/')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
    String(input) === '/api/agent/config'
      ? Response.json({ enabled: false })
      : Response.json({ ok: true, js: 'export {}', css: '', warnings: [] }),
  )
})
afterEach(() => vi.restoreAllMocks())

const configureWriter = (contents: string[]) => {
  let request = 0
  vi.mocked(fetch).mockImplementation(async input => {
    if (String(input) === '/api/agent/config')
      return Response.json({ enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' })
    if (String(input) === '/api/compile')
      return Response.json({ ok: true, js: 'export {}', css: '', warnings: [] })
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled())
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Update the page' },
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('Done.')
}

describe('gallery and project navigation', () => {
  it('creates from a template, saves Agent writes, and reopens without chat or cross-project changes', async () => {
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
    await waitFor(() => expect(screen.getByText('Saved', { exact: true })).toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: 'Files' }))
    expect(screen.getByRole('textbox', { name: 'src/app.tsx' })).toHaveValue(updated)
    first.unmount()

    render(<App />)
    await screen.findByTitle('Project preview')
    expect(screen.getByRole('region', { name: 'Conversation' })).toBeEmptyDOMElement()
    await user.click(screen.getByRole('tab', { name: 'Files' }))
    expect(screen.getByRole('textbox', { name: 'src/app.tsx' })).toHaveValue(updated)
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
    await user.click(screen.getByRole('tab', { name: 'Files' }))
    expect(screen.getByRole('textbox', { name: 'src/app.tsx' })).not.toHaveValue(updated)
  })

  it('reopens saved files at the size limit without counting project metadata', async () => {
    const database = await openProjectDatabase()
    const project = await database.createProject('blank')
    const snapshot = { entry: project.entry, files: { [project.entry]: '' } }
    const overhead = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
    snapshot.files[project.entry] = `//${'x'.repeat(2 * 1024 * 1024 - overhead - 2)}`
    try {
      await database.saveProject({ ...project, ...snapshot })
    } finally {
      database.close()
    }
    window.history.replaceState(null, '', `/projects/${project.id}`)
    render(<App />)
    expect(await screen.findByTitle('Project preview')).toBeInTheDocument()
    const compileRequest = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/compile')
    expect(JSON.parse(String(compileRequest?.[1]?.body))).toEqual(snapshot)
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
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    await sendChange()
    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect((await database.getProject(project.id))?.files).toEqual(project.files)
    expect(warning).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry save' }))
    await screen.findByText('Saved', { exact: true })
    expect((await database.getProject(project.id))?.files['src/app.tsx']).toContain('Retry me')
    database.close()
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
