import type { ExecutionEnv } from '@earendil-works/pi-agent-core'
import {
  type AgentHarnessTool,
  type AgentTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type ExecutionToolContext,
  FileError,
} from '@earendil-works/pi-agent-core'
import { type TSchema, Type } from 'typebox'
import type { ProjectRepository } from '../project/repository'
import { createProjectEnv, projectRelativePath } from './project-env'

const bindTool = <P extends TSchema, D>(
  tool: AgentHarnessTool<ExecutionToolContext, P, D>,
  context: ExecutionToolContext,
): AgentTool<P, D> => ({
  ...tool,
  executionMode: 'sequential',
  execute: async (id, args, signal, onUpdate) => {
    try {
      return await tool.execute(id, args, signal, onUpdate, context)
    } catch (cause) {
      if (cause instanceof Error && cause.cause instanceof FileError)
        throw new Error(`${cause.message} ${cause.cause.message}`, { cause })
      throw cause
    }
  },
})

export const createFileTools = (
  repository: ProjectRepository,
  env: ExecutionEnv = createProjectEnv(repository),
) => {
  const context = { env }
  const read = bindTool(createReadTool(), context)
  const listSchema = Type.Object({
    path: Type.Optional(
      Type.String({
        description: 'Project directory to list recursively. Omit to list all files.',
      }),
    ),
  })
  const list: AgentTool<typeof listSchema, undefined> = {
    name: 'list',
    label: 'list',
    description:
      'List all project-relative file paths, sorted and one per line. Does not read file contents. Optionally restrict to a directory.',
    parameters: listSchema,
    executionMode: 'sequential',
    execute: async (_id, { path }, signal) => {
      signal?.throwIfAborted()
      const relative = path === undefined ? '' : projectRelativePath(path)
      const files = repository.getFiles()
      if (files.some(file => file.path === relative)) throw new Error(`Not a directory: ${path}`)
      const paths = files
        .map(file => file.path)
        .filter(key => !relative || key.startsWith(`${relative}/`))
        .sort()
      if (relative && !paths.length) throw new Error(`Directory not found: ${path}`)
      return { content: [{ type: 'text', text: paths.join('\n') }], details: undefined }
    },
  }
  const copySchema = Type.Object({
    source: Type.String({ description: 'Existing project-relative file path.' }),
    destination: Type.String({ description: 'New project-relative file path.' }),
    overwrite: Type.Optional(
      Type.Boolean({ description: 'Replace an existing destination. Defaults to false.' }),
    ),
  })
  const copy: AgentTool<typeof copySchema, undefined> = {
    name: 'copy',
    label: 'copy',
    description:
      'Copy one project file while preserving the source. Set overwrite to true only when intentionally replacing the destination.',
    parameters: copySchema,
    executionMode: 'sequential',
    execute: async (_id, { source, destination, overwrite }, signal) => {
      signal?.throwIfAborted()
      const sourcePath = projectRelativePath(source)
      const destinationPath = projectRelativePath(destination)
      await repository.copyFile({ source: sourcePath, destination: destinationPath, overwrite })
      signal?.throwIfAborted()
      return {
        content: [{ type: 'text', text: `Copied ${sourcePath} to ${destinationPath}` }],
        details: undefined,
      }
    },
  }
  const browserRead: typeof read = {
    ...read,
    description:
      'Read a project text file. Output is limited to 2000 lines or 50 KiB. Use one-based offset and limit for large files; follow the returned offset to continue.',
    execute: async (...args: Parameters<typeof read.execute>) => {
      const result = await read.execute(...args)
      if (!result.details?.truncation?.firstLineExceedsLimit) return result
      return {
        ...result,
        content: [
          {
            type: 'text' as const,
            text: 'The requested line exceeds the 50 KiB read limit. Its content was omitted. Read other lines with offset, or ask the user for a smaller, formatted source file. No shell is available.',
          },
        ],
      }
    },
  }
  return [
    list,
    browserRead,
    copy,
    bindTool(createEditTool(), context),
    bindTool(createWriteTool(), context),
  ]
}
