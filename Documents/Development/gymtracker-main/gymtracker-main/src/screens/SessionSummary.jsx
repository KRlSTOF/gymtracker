import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getLogsByDate, getAllLogs } from '../data/db.js';
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
  const { activeBlock, completeDay, currentSession, clearCurrentSession } = useApp();

  const [summary, setSummary] = useState(null);

  const dayIndex = parseInt(dayId);
  const day = Number.isFinite(dayIndex) ? activeBlock?.days[dayIndex] : null;
  const today = localDateKey();

  useEffect(() => {
    async function buildSummary() {
      const fallbackTodayLogs = await getLogsByDate(today);
      const allLogs = await getAllLogs();
      const sessionLogs = currentSession?.sessionLogs?.length ? currentSession.sessionLogs : fallbackTodayLogs;

      const totalTonnage = sessionLogs.reduce((sum, l) => sum + l.weight * l.reps, 0);
      const setsCompleted = sessionLogs.length;
      const setsTarget = (currentSession?.sessionExercises || day?.exercises || [])
        .reduce((sum, ex) => sum + (Number(ex.targetSets) || 0), 0);
      const compromisedSets = sessionLogs.filter(l => l.compromisedForm).length;
      const seenNotes = new Set();
      const notes = sessionLogs.filter(l => l.exerciseNote || l.note).map(l => ({
        exercise: l.exerciseName,
        note: l.exerciseNote || l.note
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

      const sessionTime = currentSession?.sessionStart
        ? Math.round((Date.now() - currentSession.sessionStart) / 60000)
        : 0;

      setSummary({
        totalTonnage,
        setsCompleted,
        setsTarget,
        compromisedSets,
        notes,
        missed,
        records,
        sessionTime
      });
    }

    buildSummary();
  }, []);

  async function handleDone() {
    if (currentSession?.source !== 'ad_hoc') {
      await completeDay();
    }
    clearCurrentSession();
    navigate('/');
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

        <button className={styles.doneBtn} onClick={handleDone}>Done</button>
      </div>
    </div>
  );
}
