import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectCompileState } from '../../core/project/records'
import { createProjectStore } from '../../core/project/store'
import { PreviewPanel } from './preview-panel'
import { usePreview } from './use-preview'

const input = { entry: 'main.ts', files: { 'main.ts': 'export {}' } }
const build = (id = 'a', previewUrl = '/__preview/projects/test/builds/a/index.html') => ({
  projectId: 'test-project',
  buildId: id.repeat(64),
  compilerVersion: '1',
  entry: 'main.ts',
  files: {},
  previewUrl,
})
const result = { ok: true as const, build: build(), warnings: [] }
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const notFound = () =>
  response({ ok: false, reason: 'not-found', error: { message: 'No compiled tree exists.' } }, 404)
const persistence = {
  load: async (): Promise<ProjectCompileState | undefined> => undefined,
  save: async (_state: ProjectCompileState) => undefined,
}
const Preview = () => {
  const [project] = useState(() => createProjectStore(input))
  return <PreviewPanel {...usePreview('test-project', project, persistence)} />
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('preview lifecycle', () => {
  it('builds an absent server tree and reports runtime messages from the active iframe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(response(result))
    render(<Preview />)
    const frame = await screen.findByTitle<HTMLIFrameElement>('Project preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame).toHaveAttribute('src', result.build.previewUrl)
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'preview:error',
          phase: 'runtime',
          source: 'window',
          fatal: true,
          message: 'Render failed',
        },
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Render failed')
  })

  it('uploads only changed source and keeps the current frame until explicit refresh', async () => {
    const project = createProjectStore(input)
    const nextResult = {
      ok: true as const,
      build: build('b', '/__preview/projects/test/builds/b/index.html'),
      warnings: [],
    }
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(response(result))
      .mockResolvedValueOnce(response(nextResult))
    let preview: ReturnType<typeof usePreview> | undefined
    const Connected = () => {
      preview = usePreview('test-project', project, persistence)
      return <PreviewPanel {...preview} />
    }
    render(<Connected />)
    const frame = await screen.findByTitle('Project preview')
    act(() => project.writeFile('main.ts', 'export const updated = true'))
    await act(async () => preview?.compile())
    expect(screen.getByTitle('Project preview')).toBe(frame)
    const body = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))
    expect(body).toMatchObject({
      baseBuildId: result.build.buildId,
      entry: 'main.ts',
      changes: { 'main.ts': 'export const updated = true' },
    })
    expect(body.sourceTree['main.ts']).toMatchObject({ bytes: 27 })
    vi.useFakeTimers()
    let refresh: Promise<unknown> | undefined
    act(() => {
      refresh = preview?.refresh()
    })
    const refreshedFrame = screen.getByTitle<HTMLIFrameElement>('Project preview')
    expect(refreshedFrame).not.toBe(frame)
    act(() => {
      fireEvent(
        window,
        new MessageEvent('message', {
          source: refreshedFrame.contentWindow,
          data: { type: 'preview:loaded' },
        }),
      )
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    await act(async () => refresh)
  })

  it('refreshes a stale baseline and retries one time with the same source tree', async () => {
    const project = createProjectStore(input)
    const latest = build('b')
    const completed = { ok: true as const, build: build('c'), warnings: [] }
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(response(result))
      .mockResolvedValueOnce(
        response({ ok: false, reason: 'stale-tree', errors: [{ message: 'Tree changed' }] }, 409),
      )
      .mockResolvedValueOnce(response({ ok: true, build: latest }))
      .mockResolvedValueOnce(response(completed))
    const { result: hook } = renderHook(() => usePreview('test-project', project, persistence))
    await waitFor(() => expect(hook.current.state.status).toBe('loading'))
    act(() => project.writeFile('main.ts', 'export const value = 2'))
    await act(async () => hook.current.compile())
    expect(fetch).toHaveBeenCalledTimes(5)
    const retry = JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))
    expect(retry.baseBuildId).toBe(latest.buildId)
    expect(retry.changes).toEqual({ 'main.ts': 'export const value = 2' })
  })

  it('shows compile diagnostics and can retry the current project', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(
        response(
          {
            ok: false,
            reason: 'compile',
            errors: [{ message: 'Missing export', path: 'main.ts', line: 2, column: 3 }],
          },
          422,
        ),
      )
      .mockResolvedValueOnce(response(result))
    render(<Preview />)
    expect(await screen.findByRole('alert')).toHaveTextContent('main.ts:2:3')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTitle('Project preview')).toBeInTheDocument()
  })
})
