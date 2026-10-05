import type { RouteObject } from 'react-router'
import { HomePage } from '../pages/HomePage'
import { MaterialsPage } from '../pages/MaterialsPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { SettingsPage } from '../pages/SettingsPage'
import { StatsPage } from '../pages/StatsPage'
import { StudyPage } from '../pages/StudyPage'
import { AppLayout } from './AppLayout'
import { AuthGate } from './AuthGate'
import { RouteErrorPage } from './RouteErrorPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    // すべての画面（404 を含む）は Owner としてログインした後にだけ表示する
    element: (
      <AuthGate>
        <AppLayout />
      </AuthGate>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'study', element: <StudyPage /> },
      { path: 'materials', element: <MaterialsPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
