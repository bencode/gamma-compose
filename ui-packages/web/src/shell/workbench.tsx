import * as Tabs from '@radix-ui/react-tabs'
import { useState, useSyncExternalStore } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { Link } from 'react-router-dom'
import type { ProjectDatabase } from '../core/project/database'
import type { ProjectCompileState } from '../core/project/records'
import type { ProjectRepository } from '../core/project/repository'
import type { ProjectStore } from '../core/project/store'
import { ConversationPanel } from '../features/conversation/conversation-panel'
import { SessionControls } from '../features/conversation/session-controls'
import { useConversation } from '../features/conversation/use-conversation'
import { useMessageAttachments } from '../features/conversation/use-message-attachments'
import { useSessions } from '../features/conversation/use-sessions'
import { RepositoryBrowser } from '../features/files/repository-browser'
import { PreviewPanel } from '../features/preview/preview-panel'
import { usePreview } from '../features/preview/use-preview'
import {
  desktopLayoutStorage,
  getDesktopSnapshot,
  mobileLayoutStorage,
  subscribeDesktop,
} from './workbench-layout'

type WorkbenchProps = {
  database: ProjectDatabase
  projectId: string
  project: ProjectStore
  repository: ProjectRepository
  projectName: string
  saveStatus: 'saving' | 'saved' | 'error'
  saveError?: string
  onRetrySave: () => void
  compilePersistence: {
    load: () => Promise<ProjectCompileState | undefined>
    save: (state: ProjectCompileState) => Promise<void>
  }
}

export const Workbench = ({
  database,
  projectId,
  project,
  repository,
  projectName,
  saveStatus,
  saveError,
  onRetrySave,
  compilePersistence,
}: WorkbenchProps) => {
  const preview = usePreview(projectId, project, repository, compilePersistence)
  const attachments = useMessageAttachments(repository)
  const sessions = useSessions(database, projectId)
  const conversation = useConversation(
    projectId,
    project,
    repository,
    attachments,
    preview,
    sessions,
  )
  const running = conversation.phase === 'running' || conversation.phase === 'stopping'
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'gamma-compose-workbench-desktop',
    storage: isDesktop ? desktopLayoutStorage : mobileLayoutStorage,
    onlySaveAfterUserInteractions: true,
  })
  const [view, setView] = useState('preview')
  const [selectedPath, setSelectedPath] = useState('src/app.tsx')
  const [expandedDirectories, setExpandedDirectories] = useState(['src', 'attachments'])

  const toggleDirectory = (path: string) =>
    setExpandedDirectories(current =>
      current.includes(path) ? current.filter(item => item !== path) : [...current, path],
    )

  return (
    <Tabs.Root className="h-dvh overflow-hidden" value={view} onValueChange={setView}>
      <Group
        key={isDesktop ? 'desktop' : 'mobile'}
        className="h-full"
        orientation={isDesktop ? 'horizontal' : 'vertical'}
        disabled={!isDesktop}
        defaultLayout={isDesktop ? defaultLayout : undefined}
        onLayoutChanged={isDesktop ? onLayoutChanged : undefined}
        resizeTargetMinimumSize={{ fine: 8, coarse: 24 }}
      >
        <Panel
          id="conversation"
          defaultSize={isDesktop ? '360px' : '40%'}
          minSize={isDesktop ? '180px' : '0%'}
          groupResizeBehavior={isDesktop ? 'preserve-pixel-size' : 'preserve-relative-size'}
        >
          <aside
            className="conversation-workspace flex h-full min-h-0 min-w-0 flex-col bg-panel max-[899px]:border-b max-[899px]:border-line"
            aria-label="Conversation workspace"
          >
            <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line pr-3 pl-4">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  to="/"
                  aria-label="Back to gallery"
                  title="Back to gallery"
                  className="shrink-0 px-1 py-2 text-muted hover:text-accent"
                >
                  ←
                </Link>
                <SessionControls sessions={sessions} running={running} />
                <h1 className="min-w-0 truncate text-xs font-semibold" title={projectName}>
                  {projectName}
                </h1>
              </div>
              <Tabs.List className="view-tabs shrink-0" aria-label="Output view">
                <Tabs.Trigger className="view-tab" value="preview">
                  Preview
                </Tabs.Trigger>
                <Tabs.Trigger className="view-tab" value="repository">
                  Repository
                </Tabs.Trigger>
              </Tabs.List>
            </header>
            <ConversationPanel
              {...conversation}
              saveStatus={saveStatus}
              saveError={saveError}
              onRetrySave={onRetrySave}
              repository={repository}
              attachments={attachments}
              sessions={sessions}
              onOpenRepositoryFile={path => {
                setSelectedPath(path)
                setView('repository')
              }}
            />
          </aside>
        </Panel>
        {isDesktop && (
          <Separator
            aria-label="Resize conversation panel"
            className="relative z-10 w-px bg-line after:absolute after:inset-y-0 after:-inset-x-1 after:content-[''] focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-accent data-[separator=hover]:bg-accent data-[separator=active]:bg-accent [@media(pointer:coarse)]:after:-inset-x-3"
          />
        )}
        <Panel id="output" minSize={isDesktop ? '180px' : '0%'}>
          <main className="@container h-full min-h-0 min-w-0" aria-label="Project content">
            <Tabs.Content className="output-panel" value="preview" forceMount>
              <PreviewPanel
                {...preview}
                retryDisabled={
                  conversation.phase === 'running' || conversation.phase === 'stopping'
                }
              />
            </Tabs.Content>
            <Tabs.Content className="output-panel" value="repository">
              <RepositoryBrowser
                repository={repository}
                files={attachments.files}
                selectedPath={selectedPath}
                expandedDirectories={expandedDirectories}
                onSelectFile={setSelectedPath}
                onToggleDirectory={toggleDirectory}
                onAttach={path => attachments.attachPaths([path])}
                onDelete={async path => {
                  await repository.deleteFile(path)
                  attachments.detachPath(path)
                  setSelectedPath(current =>
                    current === path ? project.getSnapshot().entry : current,
                  )
                }}
              />
            </Tabs.Content>
          </main>
        </Panel>
      </Group>
    </Tabs.Root>
  )
}
