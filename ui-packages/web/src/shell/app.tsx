import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Workbench } from './workbench'

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Workbench />} />
      <Route
        path="*"
        element={
          <main className="not-found">
            <p className="font-mono">404</p>
            <h1>Page not found</h1>
            <Link to="/">Back to workspace</Link>
          </main>
        }
      />
    </Routes>
  </BrowserRouter>
)
