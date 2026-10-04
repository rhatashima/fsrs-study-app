import { Outlet } from 'react-router'
import { TabBar } from '../components/TabBar'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.layout}>
      <TabBar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
