import { lazy, Suspense, useEffect, useState } from 'react'
import type { ProjectRepository } from '../../core/project/repository'
import { formatBytes, type RepositoryFile } from '../../core/project/repository-files'

const MarkdownContent = lazy(async () => {
  const module = await import('../../components/markdown-content')
  return { default: module.MarkdownContent }
})

const SourceCodeViewer = lazy(async () => {
  const module = await import('./source-code-viewer')
  return { default: module.SourceCodeViewer }
})

type RepositoryPreviewProps = {
  repository: ProjectRepository
  file?: RepositoryFile
}

export const RepositoryPreview = ({ repository, file }: RepositoryPreviewProps) => {
  const [text, setText] = useState<string>()
  const [imageUrl, setImageUrl] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    let objectUrl: string | undefined
    setText(undefined)
    setImageUrl(undefined)
    setError(undefined)
    if (!file) return
    const load = async () => {
      try {
        if (file.kind === 'image') {
          objectUrl = URL.createObjectURL(await repository.readBlob(file.path))
          if (active) setImageUrl(objectUrl)
          return
        }
        const content = await repository.readText(file.path)
        if (active) setText(content)
      } catch (cause) {
        console.error(`Could not preview repository file: ${file.path}`, cause)
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not preview this file.')
      }
    }
    void load()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, repository])

  if (!file)
    return (
      <section
        className="repository-preview repository-preview-empty"
        aria-label="Repository preview"
      >
        <p>Select a file to preview it.</p>
      </section>
    )

  return (
    <section className="repository-preview" aria-label="Repository preview">
      <header className="source-header">
        <div>
          <h2>{file.path}</h2>
          <span>{formatBytes(file.size)} · Read only</span>
        </div>
      </header>
      {error ? (
        <p className="repository-preview-state" role="alert">
          {error}
        </p>
      ) : file.kind === 'image' ? (
        imageUrl ? (
          <div className="repository-image-wrap">
            <img src={imageUrl} alt={file.path.split('/').at(-1) ?? 'Repository image'} />
          </div>
        ) : (
          <p className="repository-preview-state" role="status">
            Loading image…
          </p>
        )
      ) : text === undefined ? (
        <p className="repository-preview-state" role="status">
          Loading file…
        </p>
      ) : file.kind === 'markdown' ? (
        <div className="repository-markdown">
          <Suspense fallback={<p className="repository-preview-state">Loading Markdown…</p>}>
            <MarkdownContent text={text} />
          </Suspense>
        </div>
      ) : (
        <Suspense fallback={<p className="repository-preview-state">Loading source…</p>}>
          <SourceCodeViewer key={file.path} path={file.path} value={text} />
        </Suspense>
      )}
    </section>
  )
}
