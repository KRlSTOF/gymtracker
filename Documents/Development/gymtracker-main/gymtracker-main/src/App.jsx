import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext.jsx';
import Layout from './components/Layout.jsx';
import WorkoutScreen from './screens/WorkoutScreen.jsx';
import PlannerScreen from './screens/PlannerScreen.jsx';
import AnalyticsScreen from './screens/AnalyticsScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import ExerciseSession from './screens/ExerciseSession.jsx';
import TimerScreen from './screens/TimerScreen.jsx';
import SessionSummary from './screens/SessionSummary.jsx';

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
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
