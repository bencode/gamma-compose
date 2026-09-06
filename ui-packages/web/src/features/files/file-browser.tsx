type FileBrowserProps = {
  files: Readonly<Record<string, string>>
  selectedPath: string
  expandedDirectories: readonly string[]
  onSelectFile: (path: string) => void
  onToggleDirectory: (path: string) => void
}

type DirectoryEntriesProps = FileBrowserProps & { directory?: string }

const DirectoryEntries = ({ directory = '', ...props }: DirectoryEntriesProps) => {
  const entries = [
    ...new Set(
      Object.keys(props.files)
        .filter(path => path.startsWith(directory))
        .map(path => path.slice(directory.length).split('/')[0])
        .filter((name): name is string => Boolean(name)),
    ),
  ]

  return (
    <ul className="file-list">
      {entries.map(name => {
        const path = directory + name
        const isDirectory = !Object.hasOwn(props.files, path)
        const isExpanded = props.expandedDirectories.includes(path)
        return (
          <li key={path}>
            <button
              className="file-entry"
              type="button"
              aria-expanded={isDirectory ? isExpanded : undefined}
              aria-current={!isDirectory && props.selectedPath === path ? 'true' : undefined}
              onClick={() =>
                isDirectory ? props.onToggleDirectory(path) : props.onSelectFile(path)
              }
            >
              <span className="file-symbol" aria-hidden="true">
                {isDirectory ? (isExpanded ? '⌄' : '›') : '·'}
              </span>
              <span className="file-name">{name}</span>
            </button>
            {isDirectory && isExpanded && <DirectoryEntries {...props} directory={`${path}/`} />}
          </li>
        )
      })}
    </ul>
  )
}

export const FileBrowser = (props: FileBrowserProps) => (
  <section className="file-browser" aria-label="File browser">
    <nav className="file-navigation" aria-label="Project files">
      <h2 className="file-navigation-title">Example files</h2>
      <DirectoryEntries {...props} />
    </nav>
    <section className="source-panel" aria-label="Source code">
      <header className="source-header">
        <h2>{props.selectedPath}</h2>
        <span>Read only</span>
      </header>
      <textarea
        className="source-content"
        aria-label={props.selectedPath}
        value={props.files[props.selectedPath]}
        readOnly
        wrap="off"
        spellCheck={false}
      />
    </section>
  </section>
)
