import * as Tabs from '@radix-ui/react-tabs'
import { useState, useSyncExternalStore } from 'react'
import {
  Group,
  type LayoutStorage,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Link } from 'react-router-dom'
import type { ProjectStore } from '../core/project/store'
import { ConversationPanel } from '../features/conversation/conversation-panel'
import { useConversation } from '../features/conversation/use-conversation'
import { FileBrowser } from '../features/files/file-browser'
import { PreviewPanel } from '../features/preview/preview-panel'
import { usePreview } from '../features/preview/use-preview'

const desktopQuery = '(min-width: 900px)'
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches
const subscribeDesktop = (notify: () => void) => {
  const query = window.matchMedia(desktopQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

const isStorageUnavailable = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'SecurityError' || error.name === 'QuotaExceededError')

const desktopLayoutStorage: LayoutStorage = {
  getItem(key) {
    try {
      const value = window.localStorage.getItem(key)
      if (value === null) return null
      const layout: unknown = JSON.parse(value)
      if (
        typeof layout === 'object' &&
        layout !== null &&
        !Array.isArray(layout) &&
        Object.keys(layout).length === 2 &&
        'conversation' in layout &&
        'output' in layout &&
        Object.values(layout).every(size => typeof size === 'number' && size >= 0 && size <= 100) &&
        Math.abs(Number(layout.conversation) + Number(layout.output) - 100) < 0.01
      )
        return value
      console.warn('Ignoring an invalid saved workbench layout.')
      return null
    } catch (error) {
      if (!(error instanceof SyntaxError) && !isStorageUnavailable(error)) throw error
      console.warn('Could not restore the workbench layout.', error)
      return null
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch (error) {
      if (!isStorageUnavailable(error)) throw error
      console.warn('Could not save the workbench layout.', error)
    }
  },
}

const mobileLayoutStorage: LayoutStorage = {
  getItem: () => null,
  setItem: () => undefined,
}

type WorkbenchProps = {
  project: ProjectStore
  projectName: string
  saveStatus: 'saving' | 'saved' | 'error'
  saveError?: string
  onRetrySave: () => void
}

export const Workbench = ({
  project,
  projectName,
  saveStatus,
  saveError,
  onRetrySave,
}: WorkbenchProps) => {
  const snapshot = useSyncExternalStore(project.subscribe, project.getSnapshot)
  const preview = usePreview(project)
  const conversation = useConversation(project, preview.compile)
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'gamma-compose-workbench-desktop',
    storage: isDesktop ? desktopLayoutStorage : mobileLayoutStorage,
    onlySaveAfterUserInteractions: true,
  })
  const [view, setView] = useState('preview')
  const [selectedPath, setSelectedPath] = useState('src/app.tsx')
  const [expandedDirectories, setExpandedDirectories] = useState(['src'])

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
            className="flex h-full min-h-0 min-w-0 flex-col bg-panel max-[899px]:border-b max-[899px]:border-line"
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
                <h1 className="min-w-0 truncate text-xs font-semibold" title={projectName}>
                  {projectName}
                </h1>
              </div>
              <Tabs.List className="view-tabs shrink-0" aria-label="Output view">
                <Tabs.Trigger className="view-tab" value="preview">
                  Preview
                </Tabs.Trigger>
                <Tabs.Trigger className="view-tab" value="files">
                  Files
                </Tabs.Trigger>
              </Tabs.List>
            </header>
            <ConversationPanel {...conversation} />
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2 text-xs text-muted">
              <span role={saveStatus === 'error' ? 'alert' : 'status'} title={saveError}>
                {saveStatus === 'saving'
                  ? 'Saving…'
                  : saveStatus === 'error'
                    ? 'Save failed'
                    : 'Saved'}
              </span>
              {saveStatus === 'error' && (
                <button type="button" className="text-accent underline" onClick={onRetrySave}>
                  Retry save
                </button>
              )}
            </div>
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
            <Tabs.Content className="output-panel" value="files">
              <FileBrowser
                files={snapshot.files}
                selectedPath={selectedPath}
                expandedDirectories={expandedDirectories}
                onSelectFile={setSelectedPath}
                onToggleDirectory={toggleDirectory}
              />
            </Tabs.Content>
          </main>
        </Panel>
      </Group>
    </Tabs.Root>
  )
}
