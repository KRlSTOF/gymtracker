import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getAllLogs } from '../data/db.js';
import { estimate1RM } from '../data/calculations.js';
import styles from './SessionSummary.module.css';

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function SessionSummary() {
  const { dayId } = useParams();
  const navigate = useNavigate();
  const { activeBlock, completeDay, currentSession, clearCurrentSession, loading } = useApp();

  const [summary, setSummary] = useState(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState('');

  const dayIndex = parseInt(dayId);
  const day = Number.isFinite(dayIndex) ? activeBlock?.days[dayIndex] : null;
  const today = localDateKey();

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;

    async function buildSummary() {
      const allLogs = await getAllLogs();
      const sessionMatchesRoute = currentSession && String(currentSession.dayId) === String(dayId);
      const sessionLogs = sessionMatchesRoute
        ? allLogs.filter(log => log.sessionId === currentSession.sessionId)
        : [];

      const totalTonnage = sessionLogs.reduce((sum, l) => sum + l.weight * l.reps, 0);
      const setsCompleted = sessionLogs.length;
      const setsTarget = (sessionMatchesRoute ? currentSession.sessionExercises || [] : [])
        .reduce((sum, ex) => sum + (Number(ex.targetSets) || 0), 0);
      const compromisedSets = sessionLogs.filter(l => l.compromisedForm).length;
      const seenNotes = new Set();
      const notes = sessionLogs.filter(l => l.exerciseNote || l.note).map(l => ({
        exercise: l.exerciseName,
        note: l.exerciseNote || l.note,
        switchedFrom: l.switchedFrom || ''
      })).filter(item => {
        const key = `${item.exercise}-${item.note}`;
        if (seenNotes.has(key)) return false;
        seenNotes.add(key);
        return true;
      });

      const missed = sessionLogs.filter(l =>
        l.weight < l.targetWeight || l.reps < l.targetReps
      ).map(l => ({
        exercise: l.exerciseName,
        set: l.setNumber,
        detail: l.reps < l.targetReps
          ? `${l.reps} reps (-${l.targetReps - l.reps})`
          : `${l.weight} kg (-${l.targetWeight - l.weight})`
      }));

      const records = [];
      const exerciseGroups = {};
      sessionLogs.filter(l => !l.compromisedForm).forEach(l => {
        if (!exerciseGroups[l.exerciseName]) exerciseGroups[l.exerciseName] = [];
        exerciseGroups[l.exerciseName].push(l);
      });

      for (const [name, logs] of Object.entries(exerciseGroups)) {
        const best1RM = Math.max(...logs.map(l => estimate1RM(l.weight, l.reps, l.rir)));
        const pastLogs = allLogs.filter(l => l.exerciseName === name && l.date !== today && !l.compromisedForm);
        const pastBest = pastLogs.length > 0
          ? Math.max(...pastLogs.map(l => estimate1RM(l.weight, l.reps, l.rir)))
          : 0;

        if (best1RM > pastBest && pastBest > 0) {
          records.push({ exercise: name, value: `Est. 1RM: ${best1RM.toFixed(1)} kg` });
        }
      }

      const sessionTime = sessionMatchesRoute && currentSession.sessionStart
        ? Math.round((Date.now() - currentSession.sessionStart) / 60000)
        : 0;

      if (!cancelled) setSummary({
        totalTonnage,
        setsCompleted,
        setsTarget,
        compromisedSets,
        notes,
        missed,
        records,
        sessionTime,
        sessionAvailable: Boolean(sessionMatchesRoute)
      });
    }

    buildSummary();
    return () => {
      cancelled = true;
    };
  }, [currentSession?.sessionId, dayId, loading]);

  async function handleDone() {
    if (isCompleting) return;
    if (!summary?.sessionAvailable || !currentSession) {
      navigate('/');
      return;
    }

    setIsCompleting(true);
    setCompletionError('');
    try {
      if (currentSession.source === 'plan') {
        await completeDay(currentSession.blockId, currentSession.dayId);
      }
      clearCurrentSession();
      navigate('/');
    } catch (error) {
      setCompletionError(error?.message || 'The session could not be completed.');
      setIsCompleting(false);
    }
  }

  if (!summary) {
    return <div className={styles.screen}><p>Loading...</p></div>;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.viewport}>
        <div className={styles.header}>
          <h1>Session Complete</h1>
          <p>{currentSession?.dayName || day?.name || (Number.isFinite(dayIndex) ? `Day ${dayIndex + 1}` : 'Extra Session')}</p>
        </div>

        <div className={styles.cards}>
          <div className={styles.card}>
            <h2>Overview</h2>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Time in Gym</span>
              <span className={styles.statValue}>{summary.sessionTime} min</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Total Tonnage</span>
              <span className={styles.statValue}>{summary.totalTonnage.toLocaleString()} kg</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Sets Completed</span>
              <span className={styles.statValue}>{summary.setsCompleted} / {summary.setsTarget}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Form Flags</span>
              <span className={styles.statValue}>{summary.compromisedSets}</span>
            </div>
          </div>

          {summary.missed.length > 0 && (
            <div className={styles.card}>
              <h2>Targets Missed</h2>
              {summary.missed.map((m, i) => (
                <div key={i} className={styles.stat}>
                  <span className={styles.statLabel}>{m.exercise} - Set {m.set}</span>
                  <span className={`${styles.statValue} ${styles.warning}`}>{m.detail}</span>
                </div>
              ))}
            </div>
          )}

          {summary.notes.length > 0 && (
            <div className={styles.card}>
              <h2>Exercise Notes</h2>
              {summary.notes.map((n, i) => (
                <div key={i} className={styles.noteItem}>
                  <span className={styles.statLabel}>{n.exercise}</span>
                  {n.switchedFrom && <span className={styles.statLabel}>Switched from {n.switchedFrom}</span>}
                  <p>{n.note}</p>
                </div>
              ))}
            </div>
          )}

          {summary.records.length > 0 && (
            <div className={styles.card}>
              <h2>Records</h2>
              {summary.records.map((r, i) => (
                <div key={i} className={styles.stat}>
                  <span className={styles.statLabel}>{r.exercise}</span>
                  <span className={`${styles.statValue} ${styles.success}`}>{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {!summary.sessionAvailable && (
          <p className={styles.completionError}>This summary is no longer linked to an active session. No training day will be advanced.</p>
        )}
        {completionError && <p className={styles.completionError} role="alert">{completionError}</p>}
        <button className={styles.doneBtn} onClick={handleDone} disabled={isCompleting}>
          {!summary.sessionAvailable ? 'Back to workout' : isCompleting ? 'Saving...' : 'Done'}
        </button>
      </div>
    </div>
  );
}
