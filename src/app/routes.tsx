import type { RouteObject } from 'react-router'
import { HomePage } from '../pages/HomePage'
import { MaterialsPage } from '../pages/MaterialsPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { SettingsPage } from '../pages/SettingsPage'
import { StatsPage } from '../pages/StatsPage'
import { StudyPage } from '../pages/StudyPage'
import { AppLayout } from './AppLayout'
import { RouteErrorPage } from './RouteErrorPage'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
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
