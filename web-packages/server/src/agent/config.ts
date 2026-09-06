import type { AgentConfig } from './contract.js'

export type AgentServerConfig = {
  apiKey: string
  modelId: string
}

export const readAgentConfig = (env: Record<string, string | undefined>): AgentServerConfig => ({
  apiKey: env.GLM_API_KEY?.trim() ?? '',
  modelId: env.GLM_MODEL?.trim() || 'glm-5.3',
})

export const publicAgentConfig = (config: AgentServerConfig): AgentConfig =>
  config.apiKey
    ? { enabled: true, provider: 'zai-coding-cn', modelId: config.modelId }
    : { enabled: false }
