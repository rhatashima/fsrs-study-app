import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { perfMark } from './lib/perf'
import { AuthProvider } from './app/AuthProvider'
import { RepositoryFactoryContext, type RepositoryFactory } from './app/repositoryContext'
import { routes } from './app/routes'
import { ConfigErrorPage } from './pages/ConfigErrorPage'
import { createFirestoreRepositories } from './repositories/firestore/createFirestoreRepositories'
import { getFirebaseApp } from './services/firebase/app'
import { createFirebaseAuthGateway } from './services/firebase/auth'
import { readFirebaseConfig } from './services/firebase/config'
import { getFirestoreDb } from './services/firebase/firestore'
import './styles/global.css'

perfMark('app:main-start')
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
  const app = getFirebaseApp(firebase.config)
  const gateway = createFirebaseAuthGateway(app)
  const db = getFirestoreDb(app)
  const router = createBrowserRouter(routes)
  // ログインした Owner のデータ（Firestore の users/{uid}/...）を使う
  const createRepositories: RepositoryFactory = (user) => createFirestoreRepositories(db, user.uid)

  perfMark('app:firebase-initialized')
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
