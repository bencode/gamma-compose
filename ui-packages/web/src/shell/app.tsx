import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Gallery } from '../features/projects/gallery'
import { ProjectPage } from '../features/projects/project-page'

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Gallery />} />
      <Route path="/projects/:projectId" element={<ProjectPage />} />
      <Route
        path="*"
        element={
          <main className="not-found">
            <p className="font-mono">404</p>
            <h1>Page not found</h1>
            <Link to="/">Back to gallery</Link>
          </main>
        }
      />
    </Routes>
  </BrowserRouter>
)
