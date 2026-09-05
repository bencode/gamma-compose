import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { demoFiles } from '../core/project/demo-project'
import { Workbench } from './workbench'

describe('工作台', () => {
  it('浏览示例文件时显示对应路径与纯文本源码', async () => {
    const user = userEvent.setup()
    render(<Workbench />)

    expect(screen.getByRole('region', { name: '聊天记录' })).toBeEmptyDOMElement()
    expect(screen.queryByText('草稿仅在当前页面保留，刷新后清空。')).not.toBeInTheDocument()
    expect(screen.getByText('编译器尚未接入')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: '文件' }))
    const source = screen.getByRole('region', { name: '源码' })
    expect(within(source).getByRole('heading')).toHaveTextContent('src/app.tsx')
    expect(within(source).getByRole('textbox')).toHaveValue(demoFiles['src/app.tsx'])
    expect(within(source).getByRole('textbox')).toHaveAttribute('readonly')
    expect(source.querySelector('table')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'styles.css' }))
    expect(within(source).getByRole('heading')).toHaveTextContent('src/styles.css')
    expect(within(source).getByRole('textbox')).toHaveValue(demoFiles['src/styles.css'])
  })

  it('切换视图保留草稿、文件选择和目录展开状态', async () => {
    const user = userEvent.setup()
    render(<Workbench />)
    const draft = screen.getByRole('textbox', { name: '消息' })

    await user.type(draft, '一个团队工作台')
    await user.click(screen.getByRole('tab', { name: '文件' }))
    await user.click(screen.getByRole('button', { name: 'styles.css' }))
    await user.click(screen.getByRole('button', { name: 'src' }))
    await user.click(screen.getByRole('tab', { name: '预览' }))
    expect(screen.queryByRole('region', { name: '文件浏览' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '文件' }))

    expect(draft).toHaveValue('一个团队工作台')
    expect(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('heading', { name: 'src/styles.css' })).toBeVisible()
    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'src' }))
    expect(screen.getByRole('button', { name: 'styles.css' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })
})
