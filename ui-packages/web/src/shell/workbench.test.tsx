import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoFiles } from '../core/project/demo-project'
import { Workbench } from './workbench'

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify({ ok: true, js: 'export {}', css: '', warnings: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  )
})
afterEach(() => vi.restoreAllMocks())

describe('workbench', () => {
  it('shows the selected file as read-only source', async () => {
    const user = userEvent.setup()
    render(<Workbench />)

    expect(screen.getByRole('region', { name: 'Conversation' })).toBeEmptyDOMElement()
    expect(await screen.findByTitle('Project preview')).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'Output view' }))
    await user.click(tabs.getByRole('tab', { name: 'Files' }))
    const files = within(screen.getByRole('region', { name: 'File browser' }))
    const source = screen.getByRole('region', { name: 'Source code' })
    const code = within(source).getByRole('textbox')
    expect(within(source).getByRole('heading')).toHaveTextContent('src/app.tsx')
    expect(code).toHaveValue(demoFiles['src/app.tsx'])
    expect(code).toHaveAttribute('readonly')
    expect(source.querySelector('table')).toBeNull()

    await user.click(files.getByRole('button', { name: 'styles.css' }))
    expect(within(source).getByRole('heading')).toHaveTextContent('src/styles.css')
    expect(within(source).getByRole('textbox')).toHaveValue(demoFiles['src/styles.css'])
  })

  it('preserves draft, file selection, directories and preview across tabs', async () => {
    const user = userEvent.setup()
    render(<Workbench />)
    const frame = await screen.findByTitle('Project preview')
    const draft = screen.getByRole('textbox', { name: 'Message' })
    const tabs = within(screen.getByRole('tablist', { name: 'Output view' }))

    await user.click(draft)
    await user.paste('A team workspace')
    await user.click(tabs.getByRole('tab', { name: 'Files' }))
    const files = within(screen.getByRole('region', { name: 'File browser' }))
    await user.click(files.getByRole('button', { name: 'styles.css' }))
    await user.click(files.getByRole('button', { name: 'src' }))
    await user.click(tabs.getByRole('tab', { name: 'Preview' }))
    expect(screen.queryByRole('region', { name: 'File browser' })).not.toBeInTheDocument()
    await user.click(tabs.getByRole('tab', { name: 'Files' }))

    expect(screen.getByTitle('Project preview')).toBe(frame)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(draft).toHaveValue('A team workspace')
    const visibleFiles = within(screen.getByRole('region', { name: 'File browser' }))
    expect(visibleFiles.getByRole('button', { name: 'src' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('heading', { name: 'src/styles.css' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled()
    await user.click(visibleFiles.getByRole('button', { name: 'src' }))
    expect(visibleFiles.getByRole('button', { name: 'styles.css' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })
})
