import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './markdown-content'

describe('MarkdownContent', () => {
  it('renders GFM structure, safe links and highlighted code', () => {
    const { container } = render(
      <MarkdownContent
        text={`## Result

- [x] Built

| File | State |
| --- | --- |
| app.tsx | ready |

[Docs](https://example.com)

\`\`\`typescript
const answer = 42
\`\`\``}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('table')).toHaveTextContent('app.tsx')
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container.querySelector('code')).toHaveClass('hljs', 'language-typescript')
    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const')
  })

  it('does not execute HTML or load Markdown images', () => {
    const { container } = render(
      <MarkdownContent
        text={
          '<script>window.bad = true</script>\n\n![Preview](https://example.com/a.png)\n\n[Unsafe](javascript:alert(1))'
        }
      />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Preview')).toHaveClass('markdown-image-placeholder')
    expect(screen.getByText('Unsafe').closest('a')).toBeNull()
  })
})
