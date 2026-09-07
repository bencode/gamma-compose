import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { compileProject } from './compile.js'

describe('project compilation', () => {
  it('bundles React Router from the approved package without a browser history dependency', async () => {
    const result = await compileProject({
      entry: 'main.ts',
      files: {
        'main.ts':
          "import { matchRoutes } from 'react-router-dom'; export const route = matchRoutes([{ path: '/hello' }], '/hello')?.[0]?.route.path",
      },
    })
    if (!result.ok) throw new Error(result.errors.map(error => error.message).join('\n'))
    const module = { exports: {} as { route: string } }
    const { code } = await transform(result.js, { format: 'cjs' })
    runInNewContext(code, { module, exports: module.exports, URL })
    expect(module.exports.route).toBe('/hello')
  })

  it('bundles local modules, built-in UI, Tailwind utilities and project CSS', async () => {
    const result = await compileProject({
      entry: 'src/main.tsx',
      files: {
        'src/main.tsx':
          "import { Button } from '@gamma-compose/ui'; import '@gamma-compose/ui/styles.css'; import './styles.css'; export { answer } from './data'; export const element = <Button className='p-8'>Run</Button>",
        'src/data.ts': 'export const answer: number = 42',
        'src/styles.css': '.project-heading { letter-spacing: 0.0123em; }',
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.errors.map(error => error.message).join('\n'))
    expect(result.warnings).toEqual([])
    const module = { exports: {} as { answer: number; element: { props: { children: string } } } }
    const { code } = await transform(result.js, { format: 'cjs' })
    runInNewContext(code, { module, exports: module.exports })
    expect(module.exports.answer).toBe(42)
    expect(module.exports.element.props.children).toBe('Run')
    expect(result.css).toContain('.p-8')
    expect(result.css).toContain('.bg-primary')
    expect(result.css).toContain('.project-heading')
  }, 15000)

  it.each([
    ["import './missing'", 'File not found'],
    ["import '../../private.ts'", 'escape the project'],
    ["import '/etc/passwd'", 'not allowed'],
    ["import 'node:fs'", 'not allowed'],
    ["import 'https://example.com/code.js'", 'not allowed'],
    ["import 'ramda'", 'not allowed'],
  ])('rejects unavailable or unsafe imports: %s', async (source, message) => {
    const result = await compileProject({ entry: 'src/main.ts', files: { 'src/main.ts': source } })
    expect(result).toMatchObject({
      ok: false,
      errors: [
        expect.objectContaining({
          message: expect.stringContaining(message),
          path: 'src/main.ts',
          line: 1,
        }),
      ],
    })
  })

  it('reports syntax diagnostics in project coordinates', async () => {
    const result = await compileProject({
      entry: 'src/main.ts',
      files: { 'src/main.ts': 'const invalid =' },
    })
    expect(result).toMatchObject({
      ok: false,
      errors: [
        expect.objectContaining({ path: 'src/main.ts', line: 1, column: expect.any(Number) }),
      ],
    })
  })

  it.each([
    ['@plugin "./plugin.js";', 'plugins'],
    ['@config "./config.js";', 'configuration'],
    ['@source "/private/**";', '@source'],
    ['@import "/etc/passwd";', 'not allowed'],
    ['@import "https://example.com/styles.css";', 'not allowed'],
  ])('rejects external stylesheet capabilities: %s', async (css, message) => {
    const result = await compileProject({
      entry: 'main.ts',
      files: { 'main.ts': "import './styles.css'", 'styles.css': css },
    })
    expect(result).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ message: expect.stringContaining(message) })],
    })
  })
})
