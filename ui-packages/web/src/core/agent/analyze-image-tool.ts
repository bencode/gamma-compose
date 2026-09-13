import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { ProjectRepository } from '../project/repository'

const parameters = Type.Object({
  path: Type.String({ description: 'Project-relative image path returned by list.' }),
  question: Type.Optional(
    Type.String({
      maxLength: 2000,
      description: 'A focused question about the image. Omit for a general description.',
    }),
  ),
})

export const createAnalyzeImageTool = (
  repository: ProjectRepository,
): AgentTool<typeof parameters, undefined> => ({
  name: 'analyze_image',
  label: 'analyze_image',
  description:
    'Analyze a local project image. The interface is reserved, but image analysis is not available yet.',
  parameters,
  executionMode: 'sequential',
  execute: async (_id, { path }, signal) => {
    signal?.throwIfAborted()
    const file = repository.getFiles().find(item => item.path === path)
    if (!file) throw new Error(`File not found: ${path}`)
    if (file.kind !== 'image') throw new Error(`Not an image: ${path}. Use read for text files.`)
    throw new Error('Image analysis is not available yet.')
  },
})
