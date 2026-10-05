import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AuthProvider } from './app/AuthProvider'
import { RepositoryFactoryContext, type RepositoryFactory } from './app/repositoryContext'
import { routes } from './app/routes'
import { createSampleRepositories } from './dev/sampleRepositories'
import { ConfigErrorPage } from './pages/ConfigErrorPage'
import { getFirebaseApp } from './services/firebase/app'
import { createFirebaseAuthGateway } from './services/firebase/auth'
import { readFirebaseConfig } from './services/firebase/config'
import './styles/global.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('#root element not found')
}
const root = createRoot(rootElement)
const firebase = readFirebaseConfig(import.meta.env)

if (!firebase.ok) {
  // .env.local が未設定：白画面にせず、不足している設定を表示する
  root.render(
    <StrictMode>
      <ConfigErrorPage missing={firebase.missing} />
    </StrictMode>,
  )
} else {
  const gateway = createFirebaseAuthGateway(getFirebaseApp(firebase.config))
  const router = createBrowserRouter(routes)
  // Firestore 接続（Phase 5）までは、ログインごとにダミーデータ入りのメモリ上のデータを作る
  const createRepositories: RepositoryFactory = () => createSampleRepositories()

  root.render(
    <StrictMode>
      <AuthProvider gateway={gateway} ownerUid={firebase.ownerUid}>
        <RepositoryFactoryContext value={createRepositories}>
          <RouterProvider router={router} />
        </RepositoryFactoryContext>
      </AuthProvider>
    </StrictMode>,
  )
}
