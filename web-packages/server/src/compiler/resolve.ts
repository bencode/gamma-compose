import { createRequire } from 'node:module'
import { dirname, extname, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Loader, Plugin } from 'esbuild'

const serverBase = fileURLToPath(new URL('../../', import.meta.url))
const projectNamespace = 'project-style'

export const sourceLoaders: Readonly<Record<string, Loader>> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.jsx': 'jsx',
  '.js': 'js',
  '.json': 'json',
  '.css': 'css',
}

const extensions = [
  '',
  ...Object.keys(sourceLoaders),
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
  '/index.json',
]

export const resolveProjectPath = (path: string, files: Readonly<Record<string, unknown>>) =>
  extensions.map(extension => path + extension).find(candidate => Object.hasOwn(files, candidate))

export const runtimePackages = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-router-dom',
  '@gamma-compose/local-db',
  '@gamma-compose/ui',
])

export const builtinUiRoot = dirname(createRequire(import.meta.url).resolve('@gamma-compose/ui'))

export class ProjectResolveError extends Error {}

const rejectProtocol = (specifier: string) => {
  if (/^(?:https?:|file:|node:|\/\/|\/)/.test(specifier))
    throw new ProjectResolveError(`Import is not allowed: ${specifier}`)
}

export const resolveProjectImport = (
  importer: string,
  specifier: string,
  files: Readonly<Record<string, unknown>>,
) => {
  rejectProtocol(specifier)
  if (!specifier.startsWith('.')) {
    if (!runtimePackages.has(specifier) && specifier !== '@gamma-compose/ui/styles.css')
      throw new ProjectResolveError(`Dependency is not allowed: ${specifier}`)
    return specifier
  }
  if (specifier.includes('\\')) throw new ProjectResolveError(`Import is not allowed: ${specifier}`)
  const path = posix.normalize(posix.join(posix.dirname(importer), specifier))
  if (path === '..' || path.startsWith('../'))
    throw new ProjectResolveError('Imports cannot escape the project')
  const match = resolveProjectPath(path, files)
  if (!match) throw new ProjectResolveError(`File not found: ${path}`)
  return match
}

type Builder = Parameters<Plugin['setup']>[0]

const resolvePackage = (builder: Builder, path: string, kind: string) => {
  if (path === '@gamma-compose/ui/styles.css')
    return builder.resolve(path, { kind: 'import-rule', resolveDir: serverBase })
  if (path === 'tailwindcss' && kind === 'import-rule')
    return builder.resolve(path, { kind: 'import-rule', resolveDir: serverBase })
  return { errors: [{ text: `Dependency is not allowed: ${path}` }] }
}

export const projectStylesPlugin = (
  files: Readonly<Record<string, string>>,
  stylePaths: readonly string[],
): Plugin => ({
  name: 'project-styles',
  setup(builder) {
    builder.onResolve({ filter: /^gamma-compose:styles$/ }, args =>
      args.kind === 'entry-point' ? { path: 'root', namespace: projectNamespace } : undefined,
    )
    builder.onResolve({ filter: /.*/, namespace: projectNamespace }, args => {
      if (args.importer === 'root' && args.path.startsWith('project:')) {
        const path = args.path.slice('project:'.length)
        return Object.hasOwn(files, path)
          ? { path, namespace: projectNamespace }
          : resolvePackage(builder, path, args.kind)
      }
      if (args.path === 'tailwindcss' && args.kind === 'import-rule')
        return resolvePackage(builder, args.path, args.kind)
      try {
        const path = resolveProjectImport(args.importer, args.path, files)
        return Object.hasOwn(files, path)
          ? { path, namespace: projectNamespace }
          : resolvePackage(builder, path, args.kind)
      } catch (error) {
        if (!(error instanceof ProjectResolveError)) throw error
        return { errors: [{ text: error.message }] }
      }
    })
    builder.onLoad({ filter: /^root$/, namespace: projectNamespace }, () => ({
      contents: stylePaths.map(path => `@import ${JSON.stringify(`project:${path}`)};`).join('\n'),
      loader: 'css',
    }))
    builder.onLoad({ filter: /.*/, namespace: projectNamespace }, args => {
      const loader = sourceLoaders[extname(args.path)]
      if (loader !== 'css') return { errors: [{ text: `Unsupported stylesheet: ${args.path}` }] }
      return { contents: files[args.path], loader }
    })
  },
})
