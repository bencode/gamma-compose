import type { AgentTool } from '@earendil-works/pi-agent-core'
import { describe, expect, it, vi } from 'vitest'
import { createPreviewTools } from './preview-tools'

const execute = async (tools: AgentTool[], name: string, signal?: AbortSignal) => {
  const tool = tools.find(candidate => candidate.name === name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  const result = await tool.execute('test', {}, signal)
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error('Expected a text tool result.')
  return JSON.parse(content.text) as unknown
}

describe('preview diagnostic tools', () => {
  it('reads errors and console output through separate tools', async () => {
    const readErrors = vi.fn(() => ({
      buildId: 2,
      status: 'failed' as const,
      errors: [
        {
          sequence: 1,
          phase: 'runtime' as const,
          source: 'window' as const,
          fatal: true,
          message: 'render failed',
          occurredAt: 100,
        },
      ],
      dropped: 0,
    }))
    const readConsole = vi.fn(() => ({
      buildId: 2,
      entries: [{ sequence: 2, level: 'warn' as const, message: 'retrying', occurredAt: 101 }],
      dropped: 0,
    }))
    const tools: AgentTool[] = createPreviewTools(readErrors, readConsole)
    expect(await execute(tools, 'read_preview_errors')).toMatchObject({
      status: 'failed',
      errors: [{ message: 'render failed' }],
    })
    expect(await execute(tools, 'read_preview_console')).toMatchObject({
      entries: [{ level: 'warn', message: 'retrying' }],
    })
    expect(readErrors).toHaveBeenCalledOnce()
    expect(readConsole).toHaveBeenCalledOnce()
  })

  it('does not read after cancellation', async () => {
    const readErrors = vi.fn(() => ({
      buildId: null,
      status: 'not-loaded' as const,
      errors: [],
      dropped: 0,
    }))
    const readConsole = vi.fn(() => ({ buildId: null, entries: [], dropped: 0 }))
    const controller = new AbortController()
    controller.abort()
    await expect(
      execute(
        createPreviewTools(readErrors, readConsole),
        'read_preview_errors',
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(readErrors).not.toHaveBeenCalled()
  })
})
