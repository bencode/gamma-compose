import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, highlightSpecialChars, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

type SourceCodeViewerProps = {
  path: string
  value: string
}

const languageByExtension: Readonly<Record<string, () => Extension>> = {
  css,
  js: javascript,
  jsx: () => javascript({ jsx: true }),
  json,
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
}

const languageForPath = (path: string): Extension => {
  const extension = path.split('.').at(-1)?.toLowerCase()
  return extension ? (languageByExtension[extension]?.() ?? []) : []
}

const sourceHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.operatorKeyword],
    color: 'var(--color-syntax-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--color-syntax-literal)' },
  {
    tag: [
      tags.definition(tags.variableName),
      tags.function(tags.variableName),
      tags.className,
      tags.typeName,
      tags.tagName,
    ],
    color: 'var(--color-syntax-definition)',
  },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--color-syntax-property)' },
  {
    tag: [tags.lineComment, tags.blockComment, tags.docComment],
    color: 'var(--color-syntax-comment)',
  },
  { tag: tags.invalid, color: 'var(--color-syntax-invalid)' },
])

const viewerExtensions = (path: string): Extension => [
  lineNumbers(),
  highlightSpecialChars(),
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorView.contentAttributes.of({
    'aria-label': path,
    'aria-readonly': 'true',
    role: 'textbox',
    spellcheck: 'false',
    tabindex: '0',
  }),
  syntaxHighlighting(sourceHighlightStyle),
  languageForPath(path),
]

export const SourceCodeViewer = ({ path, value }: SourceCodeViewerProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView>(null)
  const initialDocumentRef = useRef({ path, value })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const initialDocument = initialDocumentRef.current
    const editor = new EditorView({
      doc: initialDocument.value,
      extensions: viewerExtensions(initialDocument.path),
      parent: container,
    })
    editorRef.current = editor

    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.state.doc.toString() === value) return

    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    })
  }, [value])

  return <div className="source-content source-code-viewer" ref={containerRef} />
}
