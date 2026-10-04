import { NavLink } from 'react-router'
import { NAV_ITEMS } from '../app/navigation'
import styles from './TabBar.module.css'

export function TabBar() {
  return (
    <nav className={styles.bar} aria-label="メインメニュー">
      <ul className={styles.list}>
        {NAV_ITEMS.map((item) => (
          <li key={item.path} className={styles.item}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
