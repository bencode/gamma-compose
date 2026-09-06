import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Scanner } from '@tailwindcss/oxide'
import { compile } from 'tailwindcss'
import { builtinUiRoot } from './resolve.js'

export class StyleCompileError extends Error {}

const readUiSources = async () => {
  const directory = join(builtinUiRoot, 'components')
  const names = await readdir(directory)
  return Promise.all(
    names
      .filter(name => name.endsWith('.tsx'))
      .map(async name => ({
        content: await readFile(join(directory, name), 'utf8'),
        extension: 'tsx',
      })),
  )
}

export const compileStyles = async (css: string, files: Record<string, string>) => {
  if (!css) return ''
  const sources = Object.entries(files)
    .filter(([path]) => /\.(?:tsx?|jsx?)$/.test(path))
    .map(([path, content]) => ({ content, extension: extname(path).slice(1) }))
  const candidates = new Scanner({ sources: [] }).scanFiles([
    ...sources,
    ...(await readUiSources()),
  ])
  try {
    const stylesheet = await compile(css, {
      loadModule: async () => {
        throw new StyleCompileError(
          'Custom Tailwind plugins and JavaScript configuration are not supported',
        )
      },
      loadStylesheet: async () => {
        throw new StyleCompileError('Stylesheet imports must resolve within the compilation input')
      },
    })
    if (stylesheet.sources.length > 0)
      throw new StyleCompileError('Scanning directories with @source is not supported')
    return stylesheet.build(candidates)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new StyleCompileError(error.message, { cause: error })
  }
}
