import type { ProjectSnapshot } from './store'

export const blankProject: ProjectSnapshot = {
  entry: 'src/main.tsx',
  files: {
    'src/main.tsx': `import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { App } from './app'
import '@gamma-compose/ui/styles.css'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing preview root')
createRoot(root).render(<MemoryRouter><App /></MemoryRouter>)
`,
    'src/app.tsx': `import { Route, Routes } from 'react-router-dom'
import { Hello } from './pages/hello'

export const App = () => (
  <Routes>
    <Route path="/" element={<Hello />} />
    <Route path="*" element={<Hello />} />
  </Routes>
)
`,
    'src/pages/hello.tsx': `export const Hello = () => (
  <main className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center">
    <span className="text-4xl text-blue-600" aria-hidden="true">✳</span>
    <h1 className="text-5xl font-semibold tracking-tight">Hello, world.</h1>
    <p className="max-w-sm text-base leading-relaxed text-muted-foreground">A little room for your next idea.</p>
  </main>
)
`,
    'src/styles.css': 'body { min-width: 0; }\nh1 { text-wrap: balance; }\n',
    'README.md': `# Blank

A minimal React project with a Hello page and React Router.
The entry is src/main.tsx. Add page routes in src/app.tsx.
MemoryRouter keeps preview navigation separate from the editor URL.
Use @gamma-compose/ui for built-in components. Project files save automatically
in the browser; conversation history does not persist.
`,
  },
}
