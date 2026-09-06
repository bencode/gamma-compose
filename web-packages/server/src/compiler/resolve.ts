import { createRequire } from 'node:module'
import { dirname, extname, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Loader, Plugin } from 'esbuild'
import type { CompileInput } from './contract.js'

const serverBase = fileURLToPath(new URL('../../', import.meta.url))
const projectNamespace = 'project'
const loaders: Record<string, Loader> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.jsx': 'jsx',
  '.js': 'js',
  '.json': 'json',
  '.css': 'css',
}
const extensions = [
  '',
  ...Object.keys(loaders),
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
]
const packages = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@gamma-compose/ui',
  '@gamma-compose/ui/styles.css',
])

export const builtinUiRoot = dirname(createRequire(import.meta.url).resolve('@gamma-compose/ui'))

export const projectPlugin = ({ files, entry }: CompileInput): Plugin => ({
  name: 'project-files',
  setup(build) {
    build.onResolve({ filter: /^gamma-compose:entry$/ }, args =>
      args.kind === 'entry-point' ? { path: entry, namespace: projectNamespace } : undefined,
    )
    build.onResolve({ filter: /.*/, namespace: projectNamespace }, async args => {
      if (/^(?:https?:|file:|node:|\/\/)/.test(args.path)) {
        return { errors: [{ text: `Import is not allowed: ${args.path}` }] }
      }
      if (args.path.startsWith('.') && !args.path.includes('\\')) {
        const path = posix.normalize(posix.join(posix.dirname(args.importer), args.path))
        if (path === '..' || path.startsWith('../')) {
          return { errors: [{ text: 'Imports cannot escape the project' }] }
        }
        const match = extensions
          .map(extension => path + extension)
          .find(candidate => Object.hasOwn(files, candidate))
        return match
          ? { path: match, namespace: projectNamespace }
          : { errors: [{ text: `File not found: ${path}` }] }
      }
      if (args.kind === 'url-token' && args.path.startsWith('data:'))
        return { path: args.path, external: true }
      const isTailwind = args.path === 'tailwindcss' && args.kind === 'import-rule'
      if (!packages.has(args.path) && !isTailwind) {
        return { errors: [{ text: `Dependency is not allowed: ${args.path}` }] }
      }
      return build.resolve(args.path, {
        kind: args.kind,
        resolveDir: serverBase,
      })
    })
    build.onLoad({ filter: /.*/, namespace: projectNamespace }, args => {
      const loader = loaders[extname(args.path)]
      if (!loader) return { errors: [{ text: `Unsupported source format: ${args.path}` }] }
      return { contents: files[args.path], loader }
    })
  },
})
