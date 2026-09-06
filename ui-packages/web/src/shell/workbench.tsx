import * as Tabs from '@radix-ui/react-tabs'
import { useState, useSyncExternalStore } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { demoFiles, demoProject } from '../core/project/demo-project'
import { ConversationPanel } from '../features/conversation/conversation-panel'
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

export const Workbench = () => {
  const preview = usePreview(demoProject)
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot)
  const [view, setView] = useState('preview')
  const [draft, setDraft] = useState('')
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
              <h1 className="brand min-w-0 truncate" title="Gamma Compose">
                Gamma Compose<span aria-hidden="true">.</span>
              </h1>
              <Tabs.List className="view-tabs shrink-0" aria-label="Output view">
                <Tabs.Trigger className="view-tab" value="preview">
                  Preview
                </Tabs.Trigger>
                <Tabs.Trigger className="view-tab" value="files">
                  Files
                </Tabs.Trigger>
              </Tabs.List>
            </header>
            <ConversationPanel draft={draft} onDraftChange={setDraft} />
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
              <PreviewPanel {...preview} />
            </Tabs.Content>
            <Tabs.Content className="output-panel" value="files">
              <FileBrowser
                files={demoFiles}
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
