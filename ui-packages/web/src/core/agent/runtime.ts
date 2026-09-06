import { Agent } from '@earendil-works/pi-agent-core'
import { createModels } from '@earendil-works/pi-ai'
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn'
import type { AgentConfig } from '@gamma-compose/server/agent-contract'

export const createConversationAgent = (config: Extract<AgentConfig, { enabled: true }>) => {
  const models = createModels()
  models.setProvider(zaiCodingCnProvider())
  const model = models.getModel(config.provider, config.modelId)
  if (!model) throw new Error(`Unsupported GLM Coding Plan model: ${config.modelId}`)

  return new Agent({
    initialState: {
      model: { ...model, baseUrl: new URL('/api/agent', window.location.origin).href },
      systemPrompt:
        'You are the Gamma Compose assistant. Help the user discuss React pages and components. ' +
        'You currently have no tools and cannot inspect, modify, compile or run project files. ' +
        'Do not claim that you have performed those actions.',
      thinkingLevel: 'low',
      tools: [],
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
