import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { CompileResult } from '@gamma-compose/server/compile-contract'
import { Type } from 'typebox'

export type CompileProject = (signal?: AbortSignal) => Promise<CompileResult>

const modelText = (value: unknown) => {
  const text = JSON.stringify(value)
  const bytes = new TextEncoder().encode(text)
  return bytes.byteLength <= 50 * 1024
    ? text
    : `${new TextDecoder().decode(bytes.slice(0, 50 * 1024 - 100))}\n[Diagnostics truncated at 50 KiB. Fix the reported errors and compile again.]`
}

const parameters = Type.Object({})

export const createCompileTool = (
  compile: CompileProject,
): AgentTool<typeof parameters, undefined> => ({
  name: 'compile',
  label: 'compile',
  description:
    'Compile the current project and request a preview refresh on success. Returns compilation diagnostics on failure. Does not verify runtime behavior or interactions.',
  parameters,
  executionMode: 'sequential',
  execute: async (_id, _args, signal) => {
    signal?.throwIfAborted()
    let result: CompileResult
    try {
      result = await compile(signal)
    } catch (cause) {
      if (signal?.aborted) throw new Error('Compilation cancelled.', { cause })
      throw new Error(
        modelText({
          phase: 'service',
          diagnostics: [
            {
              message:
                cause instanceof Error ? cause.message : 'Compilation service request failed.',
            },
          ],
        }),
        { cause },
      )
    }
    signal?.throwIfAborted()
    if (!result.ok) throw new Error(modelText({ phase: 'compile', diagnostics: result.errors }))
    return {
      content: [
        {
          type: 'text',
          text: modelText({
            compiled: true,
            previewRefreshRequested: true,
            warnings: result.warnings,
          }),
        },
      ],
      details: undefined,
    }
  },
})
