import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'

export type RuntimeManifest = { imports: Record<string, string> }
export const runtimeVersion = '2'

const serverBase = fileURLToPath(new URL('../../', import.meta.url))
const entries: Record<string, string> = {
  react: 'react',
  react_jsx_runtime: 'react/jsx-runtime',
  react_jsx_dev_runtime: 'react/jsx-dev-runtime',
  react_dom: 'react-dom',
  react_dom_client: 'react-dom/client',
  react_router_dom: 'react-router-dom',
  gamma_local_db: '@gamma-compose/local-db',
  gamma_ui: '@gamma-compose/ui',
}

const commonJsExports: Readonly<Record<string, readonly string[]>> = {
  react: [
    'Activity',
    'Children',
    'Component',
    'Fragment',
    'Profiler',
    'PureComponent',
    'StrictMode',
    'Suspense',
    'act',
    'cache',
    'cacheSignal',
    'captureOwnerStack',
    'cloneElement',
    'createContext',
    'createElement',
    'createRef',
    'forwardRef',
    'isValidElement',
    'lazy',
    'memo',
    'startTransition',
    'use',
    'useActionState',
    'useCallback',
    'useContext',
    'useDebugValue',
    'useDeferredValue',
    'useEffect',
    'useEffectEvent',
    'useId',
    'useImperativeHandle',
    'useInsertionEffect',
    'useLayoutEffect',
    'useMemo',
    'useOptimistic',
    'useReducer',
    'useRef',
    'useState',
    'useSyncExternalStore',
    'useTransition',
    'version',
  ],
  'react/jsx-runtime': ['Fragment', 'jsx', 'jsxs'],
  'react/jsx-dev-runtime': ['Fragment', 'jsxDEV'],
  'react-dom': [
    'createPortal',
    'flushSync',
    'preconnect',
    'prefetchDNS',
    'preinit',
    'preinitModule',
    'preload',
    'preloadModule',
    'requestFormReset',
    'unstable_batchedUpdates',
    'useFormState',
    'useFormStatus',
    'version',
  ],
  'react-dom/client': ['createRoot', 'hydrateRoot', 'version'],
}

const wrapper = (specifier: string) => {
  const names = commonJsExports[specifier]
  if (!names) return `export * from ${JSON.stringify(specifier)}`
  return `import value from ${JSON.stringify(specifier)}
export default value
${names.map(name => `export const ${name} = value.${name}`).join('\n')}`
}

const runtimePlugin: Plugin = {
  name: 'preview-runtime',
  setup(builder) {
    builder.onResolve({ filter: /^runtime:/ }, args =>
      args.kind === 'entry-point'
        ? { path: args.path.slice('runtime:'.length), namespace: 'runtime' }
        : undefined,
    )
    builder.onLoad({ filter: /.*/, namespace: 'runtime' }, args => {
      const specifier = entries[args.path]
      if (!specifier) return { errors: [{ text: `Unknown runtime entry: ${args.path}` }] }
      const target =
        specifier === '@gamma-compose/local-db' ? '@gamma-compose/local-db/preview' : specifier
      return { contents: wrapper(target), loader: 'js', resolveDir: serverBase }
    })
  },
}

const runtimeRoot = (publicRoot: string) => join(publicRoot, 'runtime', runtimeVersion)
const manifestPath = (publicRoot: string) => join(runtimeRoot(publicRoot), 'manifest.json')

const readManifest = async (publicRoot: string): Promise<RuntimeManifest | undefined> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath(publicRoot), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || !('imports' in parsed)) return undefined
    if (typeof parsed.imports !== 'object' || parsed.imports === null) return undefined
    const imports = Object.fromEntries(
      Object.entries(parsed.imports).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
    if (Object.keys(imports).length !== Object.keys(entries).length) return undefined
    await Promise.all(
      Object.values(imports).map(url =>
        access(join(publicRoot, url.replace(/^\/__preview\//, ''))),
      ),
    )
    return { imports }
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    )
      return undefined
    throw error
  }
}

const buildRuntime = async (publicRoot: string): Promise<RuntimeManifest> => {
  const outputRoot = runtimeRoot(publicRoot)
  await mkdir(outputRoot, { recursive: true })
  const result = await build({
    entryPoints: Object.fromEntries(Object.keys(entries).map(name => [name, `runtime:${name}`])),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    conditions: ['source', 'development', 'browser'],
    minify: true,
    sourcemap: false,
    metafile: true,
    outdir: outputRoot,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    logLevel: 'silent',
    plugins: [runtimePlugin],
  })
  const outputEntries = Object.entries(result.metafile.outputs)
  const imports = Object.fromEntries(
    Object.entries(entries).map(([name, specifier]) => {
      const output = outputEntries.find(([, metadata]) => metadata.entryPoint === `runtime:${name}`)
      if (!output) throw new Error(`Runtime compiler did not emit ${specifier}`)
      const path = posix.join(
        '/__preview',
        relative(publicRoot, resolve(output[0])).split('\\').join('/'),
      )
      return [specifier, path]
    }),
  )
  const manifest = { imports }
  const temporary = `${manifestPath(publicRoot)}.${randomUUID()}.tmp`
  await mkdir(dirname(temporary), { recursive: true })
  await writeFile(temporary, JSON.stringify(manifest), 'utf8')
  await rename(temporary, manifestPath(publicRoot))
  return manifest
}

export const createRuntimeLoader = (publicRoot: string) => {
  let pending: Promise<RuntimeManifest> | undefined
  return () => {
    pending ??= readManifest(publicRoot).then(manifest => manifest ?? buildRuntime(publicRoot))
    return pending
  }
}
