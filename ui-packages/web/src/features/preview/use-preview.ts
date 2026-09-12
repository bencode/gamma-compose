import { LocalDbError, openLocalDb } from '@gamma-compose/local-db'
import { createLocalDbBridgeHost } from '@gamma-compose/local-db/bridge'
import type { CompileDiagnostic, CompileResult } from '@gamma-compose/server/compile-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createCompileCoordinator } from '../../core/compile/coordinator'
import type { ProjectCompileState } from '../../core/project/records'
import type { ProjectSnapshot, ProjectStore } from '../../core/project/store'
import { createPreviewDiagnostics, type PreviewDiagnostics } from './preview-diagnostics'
import type { PreviewMessage } from './preview-document'

type PreviewFrame = {
  result: Extract<CompileResult, { ok: true }>
  buildId: number
}

export type PreviewState =
  | { status: 'compiling' | 'compiled'; frame?: PreviewFrame }
  | { status: 'loading' | 'ready'; frame: PreviewFrame }
  | {
      status: 'error'
      phase: 'compile' | 'load' | 'runtime'
      errors: CompileDiagnostic[]
      frame?: PreviewFrame
    }

type CompiledArtifact = {
  snapshot: ProjectSnapshot
  result: Extract<CompileResult, { ok: true }>
}

const previewStabilityMs = 1_000

type RefreshWaiter = {
  buildId: number
  loaded: () => void
  reject: (cause: Error) => void
  dispose: () => void
}

const rejectWaiter = (pending: RefreshWaiter | undefined, cause: Error) => {
  if (!pending) return
  pending.dispose()
  pending.reject(cause)
}

export const usePreview = (
  projectId: string,
  project: ProjectStore,
  compilePersistence: {
    load: () => Promise<ProjectCompileState | undefined>
    save: (state: ProjectCompileState) => Promise<void>
  },
) => {
  const activeRequest = useRef<AbortController | null>(null)
  const artifact = useRef<CompiledArtifact | undefined>(undefined)
  const coordinator = useRef<ReturnType<typeof createCompileCoordinator>>(undefined)
  coordinator.current ??= createCompileCoordinator(projectId, compilePersistence)
  const compileCoordinator = coordinator.current
  const waiter = useRef<RefreshWaiter | undefined>(undefined)
  const buildId = useRef(0)
  const diagnosticsRef = useRef<PreviewDiagnostics | undefined>(undefined)
  diagnosticsRef.current ??= createPreviewDiagnostics()
  const diagnostics = diagnosticsRef.current
  const [state, setState] = useState<PreviewState>({ status: 'compiling' })

  const compile = useCallback(
    async (signal?: AbortSignal): Promise<CompileResult> => {
      signal?.throwIfAborted()
      activeRequest.current?.abort()
      const pending = waiter.current
      waiter.current = undefined
      rejectWaiter(pending, new DOMException('Preview refresh superseded.', 'AbortError'))
      const controller = new AbortController()
      activeRequest.current = controller
      const requestSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal
      const snapshot = project.getSnapshot()
      artifact.current = undefined
      setState(current => ({
        status: 'compiling',
        ...(current.frame ? { frame: current.frame } : {}),
      }))
      const onAbort = () => {
        if (activeRequest.current !== controller) return
        setState(current => ({
          status: 'error',
          phase: 'compile',
          errors: [{ message: 'Compilation cancelled.' }],
          ...(current.frame ? { frame: current.frame } : {}),
        }))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await compileCoordinator.compile(snapshot, requestSignal)
        requestSignal.throwIfAborted()
        if (activeRequest.current !== controller)
          throw new DOMException('Compilation superseded.', 'AbortError')
        if (result.ok) {
          artifact.current = { snapshot, result }
          setState(current => ({
            status: 'compiled',
            ...(current.frame ? { frame: current.frame } : {}),
          }))
        } else {
          setState(current => ({
            status: 'error',
            phase: 'compile',
            errors: result.errors,
            ...(current.frame ? { frame: current.frame } : {}),
          }))
        }
        return result
      } catch (cause) {
        if (activeRequest.current === controller && !requestSignal.aborted) {
          setState(current => ({
            status: 'error',
            phase: 'compile',
            errors: [
              {
                message: cause instanceof Error ? cause.message : 'The compilation request failed.',
              },
            ],
            ...(current.frame ? { frame: current.frame } : {}),
          }))
        }
        throw cause
      } finally {
        signal?.removeEventListener('abort', onAbort)
        if (activeRequest.current === controller) activeRequest.current = null
      }
    },
    [compileCoordinator, project],
  )

  const refresh = useCallback(
    (signal?: AbortSignal): Promise<{ refreshed: true; buildId: number }> => {
      signal?.throwIfAborted()
      if (activeRequest.current)
        return Promise.reject(new Error('Wait for compilation to finish before refreshing.'))
      const current = artifact.current
      if (!current || current.snapshot !== project.getSnapshot())
        return Promise.reject(
          new Error('Compile the current project successfully before refreshing.'),
        )
      const pending = waiter.current
      waiter.current = undefined
      rejectWaiter(pending, new DOMException('Preview refresh superseded.', 'AbortError'))
      const nextBuildId = ++buildId.current
      const frame = { result: current.result, buildId: nextBuildId }
      diagnostics.startBuild(nextBuildId)
      setState({ status: 'loading', frame })
      return new Promise((resolve, reject) => {
        let stabilityTimeout: number | undefined
        const finish = (action: () => void) => {
          if (waiter.current?.buildId !== nextBuildId) return
          waiter.current.dispose()
          waiter.current = undefined
          action()
        }
        const onAbort = () =>
          finish(() => {
            const error = new DOMException('Preview refresh cancelled.', 'AbortError')
            diagnostics.appendError({
              phase: 'load',
              source: 'harness',
              fatal: true,
              message: error.message,
              stack: error.stack,
            })
            setState({
              status: 'error',
              phase: 'load',
              errors: [{ message: error.message }],
              frame,
            })
            reject(error)
          })
        const timeout = window.setTimeout(
          () =>
            finish(() => {
              const error = new Error('The preview did not load within 15 seconds.')
              diagnostics.appendError({
                phase: 'load',
                source: 'harness',
                fatal: true,
                message: error.message,
                stack: error.stack,
              })
              setState({
                status: 'error',
                phase: 'load',
                errors: [{ message: error.message }],
                frame,
              })
              reject(error)
            }),
          15_000,
        )
        const loaded = () => {
          if (stabilityTimeout !== undefined) return
          window.clearTimeout(timeout)
          stabilityTimeout = window.setTimeout(
            () =>
              finish(() => {
                diagnostics.markReady(nextBuildId)
                setState(current =>
                  current.status === 'loading' && current.frame.buildId === nextBuildId
                    ? { status: 'ready', frame }
                    : current,
                )
                resolve({ refreshed: true, buildId: nextBuildId })
              }),
            previewStabilityMs,
          )
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        waiter.current = {
          buildId: nextBuildId,
          loaded,
          reject,
          dispose: () => {
            window.clearTimeout(timeout)
            if (stabilityTimeout !== undefined) window.clearTimeout(stabilityTimeout)
            signal?.removeEventListener('abort', onAbort)
          },
        }
        if (signal?.aborted) onAbort()
      })
    },
    [diagnostics, project],
  )

  const onMessage = useCallback(
    (message: PreviewMessage) => {
      if (message.type === 'preview:console') {
        diagnostics.appendConsole({ level: message.level, message: message.message })
        return
      }
      if (message.type === 'preview:loaded') {
        waiter.current?.loaded()
        return
      }
      diagnostics.appendError({
        phase: message.phase,
        source: message.source,
        fatal: message.fatal,
        message: message.message,
        ...(message.stack ? { stack: message.stack } : {}),
      })
      if (!message.fatal) return
      const error = new Error(message.message)
      const pending = waiter.current
      if (pending) {
        waiter.current = undefined
        pending.dispose()
        pending.reject(error)
      }
      setState(current => {
        if (current.status !== 'loading' && current.status !== 'ready') return current
        return {
          status: 'error',
          phase: message.phase,
          errors: [{ message: error.message }],
          frame: current.frame,
        }
      })
    },
    [diagnostics],
  )

  const retry = useCallback(() => {
    void compile()
      .then(result => (result.ok ? refresh() : undefined))
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        console.error('Preview build failed.', cause)
      })
  }, [compile, refresh])

  useEffect(() => {
    retry()
    return () => {
      activeRequest.current?.abort()
      activeRequest.current = null
      const pending = waiter.current
      waiter.current = undefined
      rejectWaiter(pending, new DOMException('Preview closed.', 'AbortError'))
    }
  }, [retry])

  const openDatabaseBridge = useCallback(
    (port: MessagePort) => {
      const host = createLocalDbBridgeHost({
        port,
        open: options => {
          if (options.databaseName !== 'app')
            throw new LocalDbError(
              'INVALID_MODEL',
              'Gamma Compose previews use the project database named app.',
            )
          return openLocalDb({ ...options, databaseName: `project:${projectId}` })
        },
      })
      return host.close
    },
    [projectId],
  )

  const readErrors = useCallback(() => diagnostics.readErrors(), [diagnostics])
  const readConsole = useCallback(() => diagnostics.readConsole(), [diagnostics])

  return {
    state,
    compile,
    refresh,
    retry,
    onMessage,
    openDatabaseBridge,
    readErrors,
    readConsole,
  }
}
