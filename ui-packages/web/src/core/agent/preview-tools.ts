import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type {
  PreviewConsoleResult,
  PreviewErrorsResult,
} from '../../features/preview/preview-diagnostics'

export type ReadPreviewErrors = () => PreviewErrorsResult
export type ReadPreviewConsole = () => PreviewConsoleResult

const parameters = Type.Object({})

export const createPreviewTools = (
  readErrors: ReadPreviewErrors,
  readConsole: ReadPreviewConsole,
): AgentTool<typeof parameters, undefined>[] => [
  {
    name: 'read_preview_errors',
    label: 'read preview errors',
    description:
      'Read captured load and runtime errors for the current preview build. Use when the user reports an error, a control that does nothing, or unexpected runtime behavior.',
    parameters,
    executionMode: 'sequential',
    execute: async (_id, _args, signal) => {
      signal?.throwIfAborted()
      return {
        content: [{ type: 'text', text: JSON.stringify(readErrors()) }],
        details: undefined,
      }
    },
  },
  {
    name: 'read_preview_console',
    label: 'read preview console',
    description:
      'Read captured console.debug, log, info, warn and error output for the current preview build.',
    parameters,
    executionMode: 'sequential',
    execute: async (_id, _args, signal) => {
      signal?.throwIfAborted()
      return {
        content: [{ type: 'text', text: JSON.stringify(readConsole()) }],
        details: undefined,
      }
    },
  },
]
