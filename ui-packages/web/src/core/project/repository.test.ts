import { describe, expect, it } from 'vitest'
import { createProjectRepository } from './repository'
import type { StoredFileMetadata } from './repository-files'
import { createProjectStore } from './store'

const setup = () => {
  const project = createProjectStore({
    entry: 'src/main.tsx',
    files: { 'src/main.tsx': 'export {}', 'README.md': '# Project' },
  })
  const contents = new Map<string, Blob>()
  const metadata = new Map<string, StoredFileMetadata>()
  const repository = createProjectRepository(
    'project-one',
    project,
    {
      getStoredFileContent: async id => contents.get(id),
      saveStoredFiles: async (files, deleteContentIds = []) => {
        files.forEach(file => {
          metadata.set(file.metadata.path, file.metadata)
          contents.set(file.metadata.contentId ?? file.metadata.id, file.blob)
        })
        deleteContentIds.forEach(id => {
          contents.delete(id)
        })
      },
      saveStoredFileMetadata: async (file, deleteContentIds = []) => {
        metadata.set(file.path, file)
        deleteContentIds.forEach(id => {
          contents.delete(id)
        })
      },
      deleteStoredFile: async (id, contentId = id) => {
        const stored = [...metadata.entries()].find(([, file]) => file.id === id)
        if (stored) metadata.delete(stored[0])
        if (contentId) contents.delete(contentId)
      },
    },
    [],
  )
  return { project, repository, contents, metadata }
}

describe('project repository', () => {
  it('merges source and uploaded files while lazily reading and editing Markdown', async () => {
    const { project, repository } = setup()
    const result = await repository.importFiles(
      [
        new File(['# Requirements'], 'requirements.md', { type: 'text/markdown' }),
        new File(['image'], 'reference.png', { type: 'image/png' }),
      ],
      'keep',
    )

    expect(result.rejected).toEqual([])
    expect(repository.getFiles().map(file => file.path)).toEqual([
      'attachments/reference.png',
      'attachments/requirements.md',
      'README.md',
      'src/main.tsx',
    ])
    expect(await repository.readText('attachments/requirements.md')).toBe('# Requirements')
    await repository.writeText('attachments/requirements.md', '# Updated')
    expect(await repository.readText('attachments/requirements.md')).toBe('# Updated')
    await expect(repository.readText('attachments/reference.png')).rejects.toThrow(
      'Use analyze_image',
    )
    expect(project.getSnapshot().files).toEqual({
      'src/main.tsx': 'export {}',
      'README.md': '# Project',
    })
  })

  it('keeps a second copy when an imported name already exists', async () => {
    const { repository } = setup()
    await repository.importFiles([new File(['first'], 'notes.md')], 'keep')
    const duplicate = new File(['second'], 'notes.md')

    await repository.importFiles([duplicate], 'keep')
    expect(repository.getFiles().map(file => file.path)).toEqual(
      expect.arrayContaining(['attachments/notes.md', 'attachments/notes (2).md']),
    )
    expect(await repository.readText('attachments/notes (2).md')).toBe('second')
  })

  it('deletes uploaded and generated attachments without allowing source deletion', async () => {
    const { contents, project, repository } = setup()
    await repository.importFiles(
      [new File(['image'], 'reference.png', { type: 'image/png' })],
      'keep',
    )
    project.writeFile('attachments/generated.md', '# Generated')

    await repository.deleteFile('attachments/reference.png')
    expect(contents.size).toBe(0)
    expect(repository.getFiles().some(file => file.path === 'attachments/reference.png')).toBe(
      false,
    )

    await repository.deleteFile('attachments/generated.md')
    expect(project.getSnapshot().files['attachments/generated.md']).toBeUndefined()
    await expect(repository.deleteFile('README.md')).rejects.toThrow(
      'Only files in the attachments',
    )
    await expect(repository.deleteFile('attachments/missing.md')).rejects.toThrow('File not found')
  })

  it('copies images by reference, preserves the source and requires explicit overwrite', async () => {
    const { contents, repository } = setup()
    await repository.importFiles(
      [new File(['image'], 'reference.png', { type: 'image/png' })],
      'keep',
    )

    await repository.copyFile({
      source: 'attachments/reference.png',
      destination: 'src/assets/hero.png',
    })
    expect(contents.size).toBe(1)
    expect(await repository.readBlob('src/assets/hero.png')).toEqual(
      await repository.readBlob('attachments/reference.png'),
    )
    await expect(
      repository.copyFile({
        source: 'attachments/reference.png',
        destination: 'src/assets/hero.png',
      }),
    ).rejects.toThrow('already exists')
    await repository.copyFile({
      source: 'attachments/reference.png',
      destination: 'src/assets/hero.png',
      overwrite: true,
    })
    expect(contents.size).toBe(1)

    await repository.deleteFile('attachments/reference.png')
    expect(contents.size).toBe(1)
    expect(await repository.readBlob('src/assets/hero.png')).toBeDefined()
  })

  it('copies text independently and rejects invalid destinations', async () => {
    const { project, repository } = setup()
    await repository.copyFile({ source: 'README.md', destination: 'src/notes.md' })
    project.writeFile('README.md', '# Changed')
    expect(await repository.readText('src/notes.md')).toBe('# Project')
    await expect(
      repository.copyFile({ source: 'README.md', destination: 'src', overwrite: true }),
    ).rejects.toThrow('directory')
    await expect(
      repository.copyFile({ source: 'README.md', destination: 'src/assets/notes.png' }),
    ).rejects.toThrow('Image files must be copied')
    await expect(
      repository.copyFile({ source: 'missing.png', destination: 'src/assets/missing.png' }),
    ).rejects.toThrow('File not found')
  })
})
