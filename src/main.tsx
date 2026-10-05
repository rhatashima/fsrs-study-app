import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { RepositoryContext } from './app/repositoryContext'
import { routes } from './app/routes'
import { createSampleRepositories } from './dev/sampleRepositories'
import './styles/global.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('#root element not found')
}

const router = createBrowserRouter(routes)
// Firestore 接続（Phase 5）までは、ダミーデータ入りのメモリ上のデータを使う
const repositories = createSampleRepositories()

createRoot(rootElement).render(
  <StrictMode>
    <RepositoryContext value={repositories}>
      <RouterProvider router={router} />
    </RepositoryContext>
  </StrictMode>,
)
