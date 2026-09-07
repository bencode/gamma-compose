import type { CompileDiagnostic, CompileResult } from '@gamma-compose/server/compile-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { compileFiles } from '../../core/compile/client'
import type { ProjectStore } from '../../core/project/store'
import type { PreviewMessage } from './preview-document'

export type PreviewState =
  | { status: 'compiling' }
  | { status: 'loading' | 'ready'; result: Extract<CompileResult, { ok: true }>; buildId: number }
  | { status: 'error'; phase: 'compile' | 'load' | 'runtime'; errors: CompileDiagnostic[] }

export const usePreview = (project: ProjectStore) => {
  const activeRequest = useRef<AbortController | null>(null)
  const buildId = useRef(0)
  const [state, setState] = useState<PreviewState>({ status: 'compiling' })
  const compile = useCallback(
    async (signal?: AbortSignal): Promise<CompileResult> => {
      signal?.throwIfAborted()
      activeRequest.current?.abort()
      const controller = new AbortController()
      activeRequest.current = controller
      const requestSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal
      const onAbort = () => {
        if (activeRequest.current === controller)
          setState({
            status: 'error',
            phase: 'compile',
            errors: [{ message: 'Compilation cancelled.' }],
          })
      }
      requestSignal.addEventListener('abort', onAbort, { once: true })
      setState({ status: 'compiling' })
      try {
        const result = await compileFiles(project.getSnapshot(), requestSignal)
        requestSignal.throwIfAborted()
        if (activeRequest.current !== controller)
          throw new DOMException('Compilation superseded.', 'AbortError')
        setState(
          result.ok
            ? { status: 'loading', result, buildId: ++buildId.current }
            : { status: 'error', phase: 'compile', errors: result.errors },
        )
        return result
      } catch (cause) {
        if (activeRequest.current === controller && !requestSignal.aborted) {
          setState({
            status: 'error',
            phase: 'compile',
            errors: [
              {
                message: cause instanceof Error ? cause.message : 'The compilation request failed.',
              },
            ],
          })
        }
        throw cause
      } finally {
        requestSignal.removeEventListener('abort', onAbort)
        if (activeRequest.current === controller) activeRequest.current = null
      }
    },
    [project],
  )

  const retry = useCallback(() => {
    void compile().catch(cause => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      console.error('Preview compilation failed.', cause)
    })
  }, [compile])
  useEffect(() => {
    retry()
    return () => {
      const controller = activeRequest.current
      activeRequest.current = null
      controller?.abort()
    }
  }, [retry])
  const onMessage = useCallback((message: PreviewMessage) => {
    setState(current => {
      if (current.status !== 'loading' && current.status !== 'ready') return current
      return message.type === 'preview:loaded'
        ? { ...current, status: 'ready' }
        : { status: 'error', phase: message.phase, errors: [{ message: message.message }] }
    })
  }, [])
  return { state, compile, retry, onMessage }
}
