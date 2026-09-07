import { Agent } from '@earendil-works/pi-agent-core'
import { createModels } from '@earendil-works/pi-ai'
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn'
import type { AgentConfig } from '@gamma-compose/server/agent-contract'
import type { ProjectStore } from '../project/store'
import { type CompileProject, createCompileTool } from './compile-tool'
import { createFileTools } from './file-tools'
import { systemPrompt } from './system-prompt'

export const createConversationAgent = (
  config: Extract<AgentConfig, { enabled: true }>,
  project: ProjectStore,
  compile: CompileProject,
) => {
  const models = createModels()
  models.setProvider(zaiCodingCnProvider())
  const model = models.getModel(config.provider, config.modelId)
  if (!model) throw new Error(`Unsupported GLM Coding Plan model: ${config.modelId}`)

  return new Agent({
    toolExecution: 'sequential',
    initialState: {
      model: { ...model, baseUrl: new URL('/api/agent', window.location.origin).href },
      systemPrompt,
      thinkingLevel: 'low',
      tools: [...createFileTools(project), createCompileTool(compile)],
    },
    streamFn: (currentModel, context, options) =>
      models.streamSimple(currentModel, context, {
        ...options,
        apiKey: 'gamma-compose-proxy',
        maxRetries: 0,
        timeoutMs: 5 * 60 * 1000,
      }),
  })
}

export const loadAgentConfig = async (signal: AbortSignal): Promise<AgentConfig> => {
  const response = await fetch('/api/agent/config', { signal, cache: 'no-store' })
  if (!response.ok) throw new Error('Could not load the chat configuration. Reload to retry.')
  const value: unknown = await response.json()
  if (typeof value === 'object' && value !== null && 'enabled' in value) {
    if (value.enabled === false) return { enabled: false }
    if (
      value.enabled === true &&
      'provider' in value &&
      value.provider === 'zai-coding-cn' &&
      'modelId' in value &&
      typeof value.modelId === 'string'
    ) {
      return { enabled: true, provider: value.provider, modelId: value.modelId }
    }
  }
  throw new Error('The server returned an invalid chat configuration.')
}
