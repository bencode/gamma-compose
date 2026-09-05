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
            <h1>这个页面不存在</h1>
            <Link to="/">返回工作台</Link>
          </main>
        }
      />
    </Routes>
  </BrowserRouter>
)
