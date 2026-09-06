import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanel } from './preview-panel'
import { usePreview } from './use-preview'

const input = { entry: 'main.ts', files: { 'main.ts': 'export {}' } }
const result = { ok: true, js: 'export {}', css: '', warnings: [] }
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const Preview = () => <PreviewPanel {...usePreview(input)} />

afterEach(() => vi.restoreAllMocks())

describe('preview lifecycle', () => {
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(result))
    render(<Preview />)
    const frame = await screen.findByTitle<HTMLIFrameElement>('Project preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    fireEvent.load(frame)
    expect(post).toHaveBeenCalledWith(
      { type: 'preview:render', js: result.js, css: result.css },
      '*',
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
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'preview:loaded' },
      }),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'preview:error', phase: 'runtime', message: '<script>throw 1</script>' },
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Page runtime error')
    expect(screen.getByRole('alert').querySelector('script')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTitle('Project preview')).not.toBe(frame))
  })

  it('surfaces network failures without leaving a loading screen', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network unavailable'))
    render(<Preview />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })
})
