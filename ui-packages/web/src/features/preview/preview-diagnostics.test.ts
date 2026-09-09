import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreviewDiagnostics } from './preview-diagnostics'

afterEach(() => vi.restoreAllMocks())

describe('preview diagnostics', () => {
  it('keeps runtime errors and console output in separate current-build buffers', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const diagnostics = createPreviewDiagnostics()
    expect(diagnostics.readErrors()).toEqual({
      buildId: null,
      status: 'not-loaded',
      errors: [],
      dropped: 0,
    })
    diagnostics.startBuild(3)
    diagnostics.appendConsole({ level: 'log', message: 'mounted' })
    diagnostics.appendError({
      phase: 'runtime',
      source: 'window',
      fatal: false,
      message: 'handled failure',
    })
    diagnostics.markReady(3)
    expect(diagnostics.readErrors()).toMatchObject({
      buildId: 3,
      status: 'ready',
      errors: [{ sequence: 2, message: 'handled failure', occurredAt: 1_000 }],
    })
    expect(diagnostics.readConsole()).toMatchObject({
      buildId: 3,
      entries: [{ sequence: 1, level: 'log', message: 'mounted', occurredAt: 1_000 }],
    })
    diagnostics.appendError({
      phase: 'runtime',
      source: 'promise',
      fatal: true,
      message: 'crashed',
    })
    expect(diagnostics.readErrors().status).toBe('failed')

    diagnostics.startBuild(4)
    expect(diagnostics.readErrors()).toMatchObject({ buildId: 4, status: 'loading', errors: [] })
    expect(diagnostics.readConsole()).toMatchObject({ buildId: 4, entries: [] })
  })

  it('drops oldest entries to keep both count and serialized size bounded', () => {
    const diagnostics = createPreviewDiagnostics()
    diagnostics.startBuild(1)
    Array.from({ length: 101 }, (_, index) => index).forEach(index => {
      diagnostics.appendConsole({ level: 'debug', message: `entry-${index}` })
    })
    const countBounded = diagnostics.readConsole()
    expect(countBounded.entries).toHaveLength(100)
    expect(countBounded.entries[0]?.message).toBe('entry-1')
    expect(countBounded.dropped).toBe(1)

    Array.from({ length: 10 }, () => undefined).forEach(() => {
      diagnostics.appendError({
        phase: 'runtime',
        source: 'window',
        fatal: false,
        message: '界'.repeat(3_000),
      })
    })
    const sizeBounded = diagnostics.readErrors()
    expect(sizeBounded.dropped).toBeGreaterThan(0)
    expect(new TextEncoder().encode(JSON.stringify(sizeBounded)).byteLength).toBeLessThan(50 * 1024)
  })

  it('returns copies that callers cannot use to mutate buffered entries', () => {
    const diagnostics = createPreviewDiagnostics()
    diagnostics.startBuild(1)
    diagnostics.appendConsole({ level: 'info', message: 'original' })
    const result = diagnostics.readConsole()
    const first = result.entries[0]
    if (first) first.message = 'changed'
    expect(diagnostics.readConsole().entries[0]?.message).toBe('original')
  })
})
