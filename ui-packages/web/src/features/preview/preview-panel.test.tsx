import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectStore } from '../../core/project/store'
import { PreviewPanel } from './preview-panel'
import { usePreview } from './use-preview'

const input = { entry: 'main.ts', files: { 'main.ts': 'export {}' } }
const result = { ok: true, js: 'export {}', css: '', warnings: [] }
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const Preview = () => {
  const [project] = useState(() => createProjectStore(input))
  return <PreviewPanel {...usePreview('test-project', project)} />
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('preview lifecycle', () => {
  it('shows an HTTP service error and recovers when Retry succeeds', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Service unavailable', { status: 503 }))
      .mockResolvedValueOnce(response(result))
    render(<Preview />)
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTitle('Project preview')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledWith('Preview build failed.', expect.any(Error))
  })

  it('keeps a compiled artifact cached until refresh explicitly reloads the frame', async () => {
    const project = createProjectStore(input)
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(result))
    let preview: ReturnType<typeof usePreview> | undefined
    const ConnectedPreview = () => {
      preview = usePreview('test-project', project)
      return <PreviewPanel {...preview} />
    }
    render(<ConnectedPreview />)
    const frame = await screen.findByTitle('Project preview')
    act(() => project.writeFile('main.ts', 'export const updated = true'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle('Project preview')).toBe(frame)
    await act(async () => {
      await preview?.compile()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual(project.getSnapshot())
    expect(screen.getByTitle('Project preview')).toBe(frame)
    expect(screen.getByRole('status')).toHaveTextContent('Build ready')
    let refresh: Promise<unknown> | undefined
    vi.useFakeTimers()
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
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => refresh)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('cancels an Agent compile, retries latest files and ignores a late cancelled response', async () => {
    const project = createProjectStore(input)
    let finishOld: ((value: Response) => void) | undefined
    let oldSignal: AbortSignal | null | undefined
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(result))
      .mockImplementationOnce((_input, init) => {
        oldSignal = init?.signal
        return new Promise<Response>(resolve => {
          finishOld = resolve
        })
      })
      .mockResolvedValueOnce(response({ ...result, js: 'latest' }))
    const { result: hook } = renderHook(() => usePreview('test-project', project))
    await waitFor(() => expect(hook.current.state.status).toBe('loading'))
    const stop = new AbortController()
    let oldRun: Promise<unknown> | undefined
    act(() => {
      oldRun = hook.current.compile(stop.signal)
    })
    const rejected = expect(oldRun).rejects.toThrow()
    act(() => stop.abort())
    expect(oldSignal?.aborted).toBe(true)
    expect(hook.current.state).toMatchObject({
      status: 'error',
      errors: [{ message: 'Compilation cancelled.' }],
    })
    act(() => {
      project.writeFile('main.ts', 'export const latest = true')
      hook.current.retry()
    })
    await waitFor(() =>
      expect(hook.current.state).toMatchObject({
        status: 'loading',
        frame: { result: { js: 'latest' } },
      }),
    )
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual(project.getSnapshot())
    await act(async () => {
      finishOld?.(response({ ...result, js: 'stale' }))
      await rejected
    })
    expect(hook.current.state).toMatchObject({ frame: { result: { js: 'latest' } } })
  })

  it('shows compilation diagnostics and retries the same project', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            ok: false,
            errors: [{ message: 'Missing export', path: 'main.ts', line: 2, column: 3 }],
          },
          422,
        ),
      )
      .mockResolvedValueOnce(response(result))
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetch)
    render(<Preview />)
    expect(screen.getByRole('status')).toHaveTextContent('Compiling preview')
    expect(await screen.findByRole('alert')).toHaveTextContent('main.ts:2:3')
    expect(screen.getByRole('alert')).toHaveTextContent('Missing export')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTitle('Project preview')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[1].body).toBe(JSON.stringify(input))
  })

  it('only accepts lifecycle messages from the active iframe and recovers from runtime errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(result))
    const project = createProjectStore(input)
    let preview: ReturnType<typeof usePreview> | undefined
    const ConnectedPreview = () => {
      preview = usePreview('test-project', project)
      return <PreviewPanel {...preview} />
    }
    render(<ConnectedPreview />)
    const frame = await screen.findByTitle<HTMLIFrameElement>('Project preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    fireEvent.load(frame)
    expect(post).toHaveBeenCalledWith(
      { type: 'preview:render', js: result.js, css: result.css },
      '*',
      [expect.any(MessagePort)],
    )
    fireEvent(
      window,
      new MessageEvent('message', { source: window, data: { type: 'preview:loaded' } }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview')
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'preview:error', phase: 'runtime', message: {} },
      }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(preview?.readErrors().errors).toEqual([])
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'preview:loaded' },
      }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview')
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'preview:console', level: 'warn', message: 'Deprecated option' },
      }),
    )
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'preview:error',
          phase: 'runtime',
          source: 'security-policy',
          fatal: false,
          message: 'img-src blocked https://example.com/image.png.',
        },
      }),
    )
    expect(preview?.readConsole().entries).toEqual([
      expect.objectContaining({ level: 'warn', message: 'Deprecated option' }),
    ])
    expect(preview?.readErrors().errors).toEqual([
      expect.objectContaining({ source: 'security-policy', fatal: false }),
    ])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: {
          type: 'preview:error',
          phase: 'runtime',
          source: 'window',
          fatal: true,
          message: '<script>throw 1</script>',
        },
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Page runtime error')
    expect(screen.getByRole('alert').querySelector('script')).toBeNull()
    expect(preview?.readErrors()).toMatchObject({
      status: 'failed',
      errors: [
        { source: 'security-policy', fatal: false },
        { source: 'window', fatal: true },
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTitle('Project preview')).not.toBe(frame))
  })

  it('surfaces network failures without leaving a loading screen', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network unavailable'))
    render(<Preview />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(report).toHaveBeenCalledWith('Preview build failed.', expect.any(Error))
  })
})
