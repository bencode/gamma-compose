import type { CompileInput } from '@gamma-compose/server/compile-contract'

export const demoFiles: Readonly<Record<string, string>> = {
  'src/main.tsx': `import { createRoot } from 'react-dom/client'
import { App } from './app'
import '@gamma-compose/ui/styles.css'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing preview root')
createRoot(root).render(<App />)
`,
  'src/app.tsx': `import { useState } from 'react'
import {
  Button, Input, Label, Dialog, DialogTrigger, DialogContent,
  DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@gamma-compose/ui'
import { ProjectTable } from './components/project-table'

export const App = () => {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')

  return (
    <main className="mx-auto max-w-5xl p-5 sm:p-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Team workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
        </div>
        <Dialog>
          <DialogTrigger asChild><Button variant="outline" className="h-auto max-w-full whitespace-normal">About this workspace</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Your team's projects</DialogTitle>
              <DialogDescription>Find projects by name or status. This example runs entirely inside the preview.</DialogDescription>
            </DialogHeader>
            <DialogFooter><DialogClose asChild><Button>Got it</Button></DialogClose></DialogFooter>
          </DialogContent>
        </Dialog>
      </header>
      <section className="mb-6 flex flex-wrap gap-4" aria-label="Project filters">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="project-search">Search projects</Label>
          <Input id="project-search" placeholder="Search by name…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="min-w-0 max-w-full space-y-2">
          <Label htmlFor="project-status">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="project-status" className="w-36 max-w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="In progress">In progress</SelectItem>
              <SelectItem value="In review">In review</SelectItem>
              <SelectItem value="Complete">Complete</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
      <ProjectTable query={query} status={status} />
    </main>
  )
}
`,
  'src/components/project-table.tsx': `import { Badge, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from '@gamma-compose/ui'

const projects = [
  { name: 'Customer workspace', owner: 'Alex Morgan', status: 'In progress' },
  { name: 'Order management', owner: 'Sam Chen', status: 'In review' },
  { name: 'Analytics dashboard', owner: 'Jordan Lee', status: 'Complete' },
]

export const ProjectTable = ({ query, status }: { query: string; status: string }) => {
  const visible = projects.filter(project =>
    project.name.toLowerCase().includes(query.toLowerCase()) &&
    (status === 'all' || project.status === status)
  )
  return (
    <Table>
      <TableCaption>{visible.length} of {projects.length} projects</TableCaption>
      <TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {visible.map(project => (
          <TableRow key={project.name}>
            <TableCell className="py-5 font-medium">{project.name}</TableCell>
            <TableCell>{project.owner}</TableCell>
            <TableCell><Badge variant={project.status === 'Complete' ? 'secondary' : 'outline'}>{project.status}</Badge></TableCell>
          </TableRow>
        ))}
        {visible.length === 0 && <TableRow><TableCell colSpan={3} className="py-10 text-center text-muted-foreground">No matching projects</TableCell></TableRow>}
      </TableBody>
    </Table>
  )
}
`,
  'src/styles.css': `body {
  min-width: 0;
}
h1 {
  text-wrap: balance;
}
`,
  'README.md': `# Team workspace

A runnable React example with searchable projects and a status filter.
The entry is src/main.tsx. Local imports resolve from this file collection.
Built-in components come from @gamma-compose/ui.

The file browser is read-only. Agent editing is not connected yet.
`,
}

export const demoProject: CompileInput = { entry: 'src/main.tsx', files: demoFiles }
