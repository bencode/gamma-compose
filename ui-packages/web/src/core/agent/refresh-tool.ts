import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

export type RefreshPreview = (signal?: AbortSignal) => Promise<{ refreshed: true; buildId: number }>

const parameters = Type.Object({})

export const createRefreshTool = (
  refresh: RefreshPreview,
): AgentTool<typeof parameters, undefined> => ({
  name: 'refresh_preview',
  label: 'refresh preview',
  description:
    'Reload the latest successful build and wait for its initial load to remain error-free for one second. Call after compile succeeds, or after database-only changes.',
  parameters,
  executionMode: 'sequential',
  execute: async (_id, _args, signal) => {
    try {
      const result = await refresh(signal)
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: undefined }
    } catch (cause) {
      if (signal?.aborted) throw new Error('Preview refresh cancelled.', { cause })
      throw cause
    }
  },
})
