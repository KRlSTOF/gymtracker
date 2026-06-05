import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getLogsByExercise, getHistoryByExercise, getAllLogs, addLog, updateExercise, getExerciseByName } from '../data/db.js';
import { findReference } from '../data/calculations.js';
import styles from './ExerciseSession.module.css';

const RIR_OPTIONS = ['0', '1', '1-2', '2', '2-3', '3', '3-4'];

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ExerciseSession() {
  const { dayId, exerciseIndex } = useParams();
  const navigate = useNavigate();
  const {
    activeBlock,
    currentSession,
    exercises,
    appSettings,
    setCurrentSession,
    refreshExercises
  } = useApp();

  const exIdx = parseInt(exerciseIndex);
  const usingSessionQueue = Boolean(currentSession?.sessionExercises?.length) &&
    (String(currentSession.dayId) === String(dayId) || dayId === 'session');
  const dayIdx = usingSessionQueue ? currentSession.dayId : parseInt(dayId);
  const day = Number.isFinite(dayIdx) ? activeBlock?.days[dayIdx] : null;
  const exercise = usingSessionQueue ? currentSession.sessionExercises[exIdx] : day?.exercises[exIdx];
  const libraryExercise = exercises.find(ex =>
    exercise?.libraryId ? String(ex.id) === String(exercise.libraryId) : ex.name === exercise?.name
  );

  const priorExerciseSets = usingSessionQueue
    ? (currentSession.sessionLogs || []).filter(log => log.sessionExerciseId === exercise?.sessionExerciseId)
    : [];

  const [completedSets, setCompletedSets] = useState(priorExerciseSets);
  const [weight, setWeight] = useState(exercise?.targetWeight || 0);
  const [reps, setReps] = useState(exercise?.targetReps || 10);
  const [rir, setRIR] = useState(exercise?.targetRIR || '2');
  const [exerciseNote, setExerciseNote] = useState(libraryExercise?.note || libraryExercise?.notes || exercise?.note || exercise?.notes || '');
  const [noteHistory, setNoteHistory] = useState([]);
  const [noteStatus, setNoteStatus] = useState('');
  const [compromisedForm, setCompromisedForm] = useState(false);
  const [reference, setReference] = useState({ exactMatch: null, anyMatch: null });
  const [sessionStart] = useState(currentSession?.sessionStart || Date.now());
  const [sessionId] = useState(currentSession?.sessionId || `session-${Date.now()}`);

  const currentSet = completedSets.length + 1;
  const totalSets = exercise?.targetSets || 3;
  const weightStep = exercise?.weightStep || libraryExercise?.weightStep || appSettings.defaultWeightStep || 2.5;

  useEffect(() => {
    async function loadReferenceAndNotes() {
      if (!exercise) return;
      const allLogs = await getAllLogs();
      let matchedLogs = [];

      if (exercise.libraryId) {
        const logs = await getLogsByExercise(exercise.libraryId);
        matchedLogs = logs;
        if (logs.length > 0) {
          setReference(findReference(logs, exercise.targetRIR));
        }
      }

      if (matchedLogs.length === 0) {
        matchedLogs = allLogs.filter(log => log.exerciseName === exercise.name);
        if (matchedLogs.length > 0) {
          setReference(findReference(matchedLogs, exercise.targetRIR));
        }
      }

      const history = await getHistoryByExercise(exercise.name);
      if (matchedLogs.length === 0 && history.length > 0) {
        const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
        setReference({ exactMatch: null, anyMatch: sorted[0] });
      }

      const notes = [
        ...matchedLogs
          .filter(log => log.exerciseNote || log.note)
          .map(log => ({
            date: log.date,
            text: log.exerciseNote || log.note,
            source: 'Workout'
          })),
        ...history
          .filter(item => item.comment)
          .map(item => ({
            date: item.date,
            text: item.comment,
            source: 'FitNotes'
          }))
      ];

      const seen = new Set();
      setNoteHistory(notes
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .filter(item => {
          const key = `${item.date}-${item.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 8));
    }
    loadReferenceAndNotes();
  }, [exercise]);

  useEffect(() => {
    if (exercise) {
      setWeight(exercise.targetWeight);
      setReps(exercise.targetReps);
      setRIR(exercise.targetRIR);
      setExerciseNote(libraryExercise?.note || libraryExercise?.notes || exercise.note || exercise.notes || '');
      setNoteStatus('');
      setCompromisedForm(false);
    }
  }, [completedSets.length, exercise, libraryExercise]);

  if (!exercise) {
    return (
      <div className={styles.screen}>
        <div className={styles.emptyState}>
          <p>No exercise selected. Add an exercise from the workout screen.</p>
          <button onClick={() => navigate('/')}>Back to Workout</button>
        </div>
      </div>
    );
  }

  const sessionExercises = currentSession?.sessionExercises || day?.exercises || [];
  const nextExercise = sessionExercises[exIdx + 1];
  const lastReference = reference.anyMatch || reference.exactMatch;

  function quickFillFromLast() {
    if (!lastReference) return;
    setWeight(Number(lastReference.weight) || 0);
    setReps(Number(lastReference.reps) || 0);
    setRIR(lastReference.rir || exercise.targetRIR || '2');
  }

  async function saveExerciseNote() {
    const existing = libraryExercise || await getExerciseByName(exercise.name);
    if (existing) {
      await updateExercise({ ...existing, note: exerciseNote, notes: exerciseNote, updatedAt: new Date().toISOString() });
      await refreshExercises();
    }
    if (currentSession?.sessionExercises) {
      setCurrentSession({
        ...currentSession,
        sessionExercises: currentSession.sessionExercises.map((item, index) => (
          index === exIdx ? { ...item, note: exerciseNote } : item
        ))
      });
    }
    setNoteStatus(existing ? 'Note saved to exercise library' : 'Note saved for this session');
  }

  async function confirmSet() {
    const previousSessionLogs = currentSession?.sessionLogs || [];
    const sessionExerciseId = exercise.sessionExerciseId || `legacy-${dayIdx}-${exIdx}`;

    const setData = {
      sessionId,
      sessionExerciseId,
      exerciseId: exercise.libraryId,
      exerciseName: exercise.name,
      muscleGroup: exercise.muscleGroup,
      date: localDateKey(),
      dayId,
      exerciseIndex: exIdx,
      setNumber: currentSet,
      weight,
      reps,
      rir,
      note: exerciseNote.trim(),
      exerciseNote: exerciseNote.trim(),
      compromisedForm,
      targetWeight: exercise.targetWeight,
      targetReps: exercise.targetReps,
      targetRIR: exercise.targetRIR,
      timestamp: Date.now()
    };

    await addLog(setData);
    const updatedExerciseSets = [...completedSets, setData];
    const updatedSessionLogs = [...previousSessionLogs, setData];
    setCompletedSets(updatedExerciseSets);

    const isLastSet = updatedExerciseSets.length >= totalSets;
    const nextInfo = isLastSet
      ? { type: 'exercise', exerciseIndex: exIdx + 1, dayId }
      : { type: 'set', setNumber: currentSet + 1, exercise: exercise.name };

    setCurrentSession({
      ...(currentSession || {}),
      sessionId,
      source: currentSession?.source || 'plan',
      dayId,
      exerciseIndex: exIdx,
      exerciseSets: updatedExerciseSets,
      completedSets: updatedExerciseSets,
      sessionLogs: updatedSessionLogs,
      sessionStart,
      next: nextInfo,
      exercise: { ...exercise, note: exerciseNote },
      isLastSet
    });

    navigate('/timer');
  }

  function adjustWeight(delta) {
    setWeight(prev => Math.max(0, +(prev + delta * weightStep).toFixed(1)));
  }

  function adjustReps(delta) {
    setReps(prev => Math.max(0, prev + delta));
  }

  return (
    <div className={styles.screen}>
      <div className={styles.stickyHeader}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>{'<'}</button>
        <div className={styles.headerInfo}>
          <div className={styles.headerName}>{exercise.name}</div>
          <div className={styles.headerProgress}>Set {currentSet} of {totalSets} planned</div>
        </div>
        <div style={{ width: 40 }} />
      </div>

      <div className={styles.scrollContent}>
        <div className={styles.centeredContent}>
          <div className={styles.targetSection}>
            <div className={styles.muscleTag}>{exercise.muscleGroup}</div>
            <h1 className={styles.exerciseTitle}>{exercise.name}</h1>
            <div className={styles.targetGrid}>
              <div className={styles.targetItem}>
                <label>Sets</label>
                <div className={styles.targetValue}>{totalSets}</div>
              </div>
              <div className={styles.targetItem}>
                <label>Weight</label>
                <div className={styles.targetValue}>{exercise.targetWeight}<span>kg</span></div>
              </div>
              <div className={styles.targetItem}>
                <label>Reps</label>
                <div className={styles.targetValue}>{exercise.targetReps}</div>
              </div>
              <div className={styles.targetItem}>
                <label>RIR</label>
                <div className={styles.targetValue}>{exercise.targetRIR}</div>
              </div>
            </div>
          </div>

          {(reference.exactMatch || reference.anyMatch) && (
            <div className={styles.reference}>
              {reference.exactMatch && (
                <div className={styles.refLine}>
                  @ RIR {reference.exactMatch.rir} - {reference.exactMatch.weight} kg x {reference.exactMatch.reps} ({reference.exactMatch.date})
                </div>
              )}
              {reference.anyMatch && reference.anyMatch !== reference.exactMatch && (
                <div className={styles.refLine}>
                  @ RIR {reference.anyMatch.rir || '?'} - {reference.anyMatch.weight} kg x {reference.anyMatch.reps} ({reference.anyMatch.date})
                </div>
              )}
              <button className={styles.quickFillBtn} onClick={quickFillFromLast}>
                Fill from last
              </button>
            </div>
          )}

          <div className={styles.exerciseNotes}>
            <div className={styles.notesLabel}>Exercise note</div>
            <textarea
              rows="3"
              value={exerciseNote}
              onChange={event => setExerciseNote(event.target.value)}
              placeholder="Technique cues, setup reminders, or planner pointers..."
            />
            <div className={styles.noteActions}>
              <button onClick={saveExerciseNote}>Save Note</button>
              {noteStatus && <span>{noteStatus}</span>}
            </div>
            {noteHistory.length > 0 && (
              <div className={styles.pastNotes}>
                <div className={styles.notesLabel}>Past notes</div>
                {noteHistory.map((item, index) => (
                  <p key={`${item.date}-${index}`}><strong>{item.date}</strong> ({item.source}) - {item.text}</p>
                ))}
              </div>
            )}
          </div>

          {completedSets.length > 0 && (
            <div className={styles.completedSection}>
              {completedSets.map((s, i) => (
                <div key={i} className={styles.completedSet}>
                  <span>
                    Set {i + 1} - {s.weight} kg x {s.reps} @ RIR {s.rir}
                    {s.compromisedForm ? ' - form flagged' : ''}
                  </span>
                  <span className={styles.check}>OK</span>
                </div>
              ))}
            </div>
          )}

          <div className={styles.inputSection}>
            <div className={styles.sectionTitle}>Set {currentSet} - Log</div>

            <div className={styles.inputGrid}>
              <div className={styles.inputField}>
                <label>Weight</label>
                <div className={styles.inputWrapper}>
                  <button onClick={() => adjustWeight(-1)}>-</button>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={weight}
                    onChange={e => setWeight(parseFloat(e.target.value) || 0)}
                  />
                  <button onClick={() => adjustWeight(1)}>+</button>
                </div>
              </div>
              <div className={styles.inputField}>
                <label>Reps</label>
                <div className={styles.inputWrapper}>
                  <button onClick={() => adjustReps(-1)}>-</button>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={reps}
                    onChange={e => setReps(parseInt(e.target.value) || 0)}
                  />
                  <button onClick={() => adjustReps(1)}>+</button>
                </div>
              </div>
            </div>

            <div className={styles.rirSection}>
              <label className={styles.rirLabel}>RIR</label>
              <div className={styles.rirOptions}>
                {RIR_OPTIONS.map(option => (
                  <button
                    key={option}
                    className={`${styles.rirOption} ${rir === option ? styles.selected : ''}`}
                    onClick={() => setRIR(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <label className={styles.flagToggle}>
              <input
                type="checkbox"
                checked={compromisedForm}
                onChange={e => setCompromisedForm(e.target.checked)}
              />
              <span>Form compromised</span>
            </label>
          </div>
        </div>
      </div>

      <div className={styles.bottomSection}>
        {nextExercise && (
          <div className={styles.nextExercise}>
            <div className={styles.nextLabel}>Up Next</div>
            <div className={styles.nextName}>
              {nextExercise.name} - {nextExercise.targetSets} x {nextExercise.targetReps} @ {nextExercise.targetWeight} kg
            </div>
          </div>
        )}
        <button className={styles.confirmBtn} onClick={confirmSet}>
          Confirm Set
        </button>
      </div>
    </div>
  );
}
