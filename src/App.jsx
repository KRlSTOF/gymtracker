import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext.jsx';
import Layout from './components/Layout.jsx';
import WorkoutScreen from './screens/WorkoutScreen.jsx';
import PlannerScreen from './screens/PlannerScreen.jsx';
import AnalyticsScreen from './screens/AnalyticsScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import ExerciseSession from './screens/ExerciseSession.jsx';
import TimerScreen from './screens/TimerScreen.jsx';
import SessionSummary from './screens/SessionSummary.jsx';

const ROOT_ROUTES = new Set(['/', '/planner', '/analytics', '/settings']);

function closeTransientUi() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const tagName = active.tagName.toLowerCase();
    const isEditable =
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      active.isContentEditable;

    if (isEditable) {
      active.blur();
      return true;
    }
  }

  const openDialog = document.querySelector('dialog[open]');
  if (openDialog && typeof openDialog.close === 'function') {
    openDialog.close();
    return true;
  }

  const modal = document.querySelector('[aria-modal="true"], [role="dialog"]');
  if (modal) {
    const event = new CustomEvent('app-shell-back', { bubbles: true, cancelable: true });
    modal.dispatchEvent(event);
    return event.defaultPrevented;
  }

  return false;
}

function CapacitorShell() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let listener;
    let isMounted = true;

    CapacitorApp
      .addListener('backButton', () => {
        if (closeTransientUi()) return;

        if (!ROOT_ROUTES.has(location.pathname)) {
          navigate(-1);
        } else {
          CapacitorApp.minimizeApp().catch(() => {});
        }
      })
      .then(handle => {
        if (isMounted) {
          listener = handle;
        } else {
          handle?.remove?.();
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      listener?.remove?.();
    };
  }, [location.pathname, navigate]);

  return null;
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <CapacitorShell />
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<WorkoutScreen />} />
            <Route path="/planner" element={<PlannerScreen />} />
            <Route path="/analytics" element={<AnalyticsScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Route>
          <Route path="/exercise/:dayId/:exerciseIndex" element={<ExerciseSession />} />
          <Route path="/timer" element={<TimerScreen />} />
          <Route path="/summary/:dayId" element={<SessionSummary />} />
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
