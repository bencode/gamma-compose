import type {
  CompileDiagnostic,
  CompileInput,
  CompileResult,
} from '@gamma-compose/server/compile-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { compileFiles } from '../../core/compile/client'
import type { PreviewMessage } from './preview-document'

export type PreviewState =
  | { status: 'compiling' }
  | { status: 'loading' | 'ready'; result: Extract<CompileResult, { ok: true }> }
  | { status: 'error'; phase: 'compile' | 'load' | 'runtime'; errors: CompileDiagnostic[] }

export const usePreview = (input: CompileInput) => {
  const activeRequest = useRef<AbortController | null>(null)
  const [state, setState] = useState<PreviewState>({ status: 'compiling' })
  const retry = useCallback(() => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setState({ status: 'compiling' })
    compileFiles(input, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setState(
          result.ok
            ? { status: 'loading', result }
            : { status: 'error', phase: 'compile', errors: result.errors },
        )
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          phase: 'compile',
          errors: [
            {
              message: error instanceof Error ? error.message : 'The compilation request failed.',
            },
          ],
        })
      })
  }, [input])

  useEffect(() => {
    retry()
    return () => activeRequest.current?.abort()
  }, [retry])
  const onMessage = useCallback((message: PreviewMessage) => {
    setState(current => {
      if (current.status !== 'loading' && current.status !== 'ready') return current
      return message.type === 'preview:loaded'
        ? { ...current, status: 'ready' }
        : { status: 'error', phase: message.phase, errors: [{ message: message.message }] }
    })
  }, [])
  return { state, retry, onMessage }
}
