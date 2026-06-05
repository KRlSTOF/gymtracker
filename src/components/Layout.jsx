import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import styles from './Layout.module.css';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = [
    { path: '/', label: 'Workout', icon: '◉' },
    { path: '/planner', label: 'Planner', icon: '▦' },
    { path: '/analytics', label: 'Analytics', icon: '◔' },
    { path: '/settings', label: 'Settings', icon: '⚙' }
  ];

  return (
    <div className={styles.layout}>
      <div className={styles.content}>
        <Outlet />
      </div>
      <nav className={styles.nav}>
        {tabs.map(tab => (
          <button
            key={tab.path}
            className={`${styles.navItem} ${location.pathname === tab.path ? styles.active : ''}`}
            onClick={() => navigate(tab.path)}
          >
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
