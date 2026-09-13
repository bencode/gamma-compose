import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

const MarkdownBody = ({ text }: { text: string }) => (
  <div className="markdown-content" data-testid="markdown-content">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        a: ({ node: _node, href, children, ...props }) =>
          href ? (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
        img: ({ node: _node, alt }) => (
          <span className="markdown-image-placeholder">{alt || 'Image'}</span>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  </div>
)

export const MarkdownContent = memo(MarkdownBody)
