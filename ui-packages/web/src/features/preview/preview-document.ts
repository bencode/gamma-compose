import type { PreviewConsoleLevel, PreviewErrorSource } from './preview-diagnostics'

export type PreviewMessage =
  | { type: 'preview:loaded' }
  | {
      type: 'preview:error'
      phase: 'load' | 'runtime'
      source: PreviewErrorSource
      fatal: boolean
      message: string
      stack?: string
    }
  | { type: 'preview:console'; level: PreviewConsoleLevel; message: string }

const errorSources: readonly PreviewErrorSource[] = [
  'module',
  'window',
  'promise',
  'form',
  'security-policy',
  'harness',
]
const consoleLevels: readonly PreviewConsoleLevel[] = ['debug', 'log', 'info', 'warn', 'error']

export const isPreviewMessage = (value: unknown): value is PreviewMessage => {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  if (value.type === 'preview:loaded') return true
  if (
    value.type === 'preview:error' &&
    'phase' in value &&
    (value.phase === 'load' || value.phase === 'runtime') &&
    'source' in value &&
    errorSources.includes(value.source as PreviewErrorSource) &&
    'fatal' in value &&
    typeof value.fatal === 'boolean' &&
    'message' in value &&
    typeof value.message === 'string' &&
    (!('stack' in value) || value.stack === undefined || typeof value.stack === 'string')
  )
    return true
  return (
    value.type === 'preview:console' &&
    'level' in value &&
    consoleLevels.includes(value.level as PreviewConsoleLevel) &&
    'message' in value &&
    typeof value.message === 'string'
  )
}
