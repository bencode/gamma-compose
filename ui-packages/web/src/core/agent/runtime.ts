import { Agent } from '@earendil-works/pi-agent-core'
import { createModels } from '@earendil-works/pi-ai'
import { zaiCodingCnProvider } from '@earendil-works/pi-ai/providers/zai-coding-cn'
import type { AgentConfig } from '@gamma-compose/server/agent-contract'
import type { ProjectRepository } from '../project/repository'
import type { ProjectStore } from '../project/store'
import { createAnalyzeImageTool } from './analyze-image-tool'
import { builtInSkillFiles, builtInSkills } from './builtin-skills'
import { type CompileProject, createCompileTool } from './compile-tool'
import { createDbTools } from './db-tools'
import { createFileTools } from './file-tools'
import {
  createPreviewTools,
  type ReadPreviewConsole,
  type ReadPreviewErrors,
} from './preview-tools'
import { createProjectEnv } from './project-env'
import { createRefreshTool, type RefreshPreview } from './refresh-tool'
import { createSystemPrompt } from './system-prompt'

export type AgentPreview = {
  compile: CompileProject
  refresh: RefreshPreview
  readErrors: ReadPreviewErrors
  readConsole: ReadPreviewConsole
}

export const createConversationAgent = (
  config: Extract<AgentConfig, { enabled: true }>,
  projectId: string,
  project: ProjectStore,
  repository: ProjectRepository,
  preview: AgentPreview,
) => {
  const models = createModels()
  models.setProvider(zaiCodingCnProvider())
  const model = models.getModel(config.provider, config.modelId)
  if (!model) throw new Error(`Unsupported GLM Coding Plan model: ${config.modelId}`)

  const env = createProjectEnv(repository, builtInSkillFiles)
  return new Agent({
    toolExecution: 'sequential',
    initialState: {
      model: { ...model, baseUrl: new URL('/api/agent', window.location.origin).href },
      systemPrompt: createSystemPrompt(builtInSkills),
      thinkingLevel: 'low',
      tools: [
        ...createFileTools(repository, env),
        createAnalyzeImageTool(repository),
        ...createDbTools(projectId, project),
        createCompileTool(preview.compile),
        createRefreshTool(preview.refresh),
        ...createPreviewTools(preview.readErrors, preview.readConsole),
      ],
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
