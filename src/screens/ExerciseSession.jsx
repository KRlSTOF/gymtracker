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

function formatLogDate(value) {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function cleanPastNoteText(value) {
  const text = String(value || '').trim();
  const cleaned = text
    .split('|')
    .map(part => part.trim())
    .filter(part => part && !/^RIR\b/i.test(part) && !/^Form compromised$/i.test(part))
    .join(' | ');
  return cleaned || text;
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
  const [exerciseNote, setExerciseNote] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
      setReference({ exactMatch: null, anyMatch: null });
      setNoteHistory([]);
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
            setNumber: log.setNumber,
            weight: log.weight,
            reps: log.reps,
            rir: log.rir,
            text: cleanPastNoteText(log.exerciseNote || log.note),
            source: 'Workout'
          })),
        ...history
          .filter(item => item.comment)
          .map(item => ({
            date: item.date,
            setNumber: item.setNumber,
            weight: item.weight,
            reps: item.reps,
            rir: item.rir,
            text: cleanPastNoteText(item.comment),
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
      const target = getSetTarget(completedSets.length + 1);
      setWeight(target.weight);
      setReps(target.reps);
      setRIR(target.rir);
      setExerciseNote('');
      setNotesOpen(false);
      setHistoryOpen(false);
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
  const currentTarget = getSetTarget(currentSet);
  const targetReached = completedSets.length >= totalSets;
  const displayTarget = targetReached ? getSetTarget(totalSets) : currentTarget;
  const upcomingTargets = Array.from(
    { length: Math.max(0, totalSets - currentSet) },
    (_, index) => getSetTarget(currentSet + index + 1)
  ).slice(0, 4);
  const referenceItems = [
    reference.exactMatch ? { label: `Target RIR ${exercise.targetRIR}`, item: reference.exactMatch } : null,
    reference.anyMatch && reference.anyMatch !== reference.exactMatch ? { label: 'Most recent', item: reference.anyMatch } : null
  ].filter(Boolean);

  function getSetTarget(setNumber) {
    const perSetTargets = exercise?.setTargets || exercise?.targets || exercise?.sets;
    const target = Array.isArray(perSetTargets) ? perSetTargets[setNumber - 1] : null;

    return {
      setNumber,
      weight: target?.targetWeight ?? target?.weight ?? exercise.targetWeight,
      reps: target?.targetReps ?? target?.reps ?? exercise.targetReps,
      rir: target?.targetRIR ?? target?.rir ?? exercise.targetRIR
    };
  }

  function quickFillFromLast() {
    if (!lastReference) return;
    setWeight(Number(lastReference.weight) || 0);
    setReps(Number(lastReference.reps) || 0);
    setRIR(lastReference.rir || exercise.targetRIR || '2');
  }

  async function saveExerciseNote() {
    const noteText = exerciseNote.trim();
    if (!noteText) {
      setNoteStatus('Add a note before saving');
      return;
    }
    const existing = libraryExercise || await getExerciseByName(exercise.name);
    if (existing) {
      await updateExercise({ ...existing, note: noteText, notes: noteText, updatedAt: new Date().toISOString() });
      await refreshExercises();
    }
    if (currentSession?.sessionExercises) {
      setCurrentSession({
        ...currentSession,
        sessionExercises: currentSession.sessionExercises.map((item, index) => (
          index === exIdx ? { ...item, note: noteText } : item
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
      targetWeight: currentTarget.weight,
      targetReps: currentTarget.reps,
      targetRIR: currentTarget.rir,
      timestamp: Date.now()
    };

    await addLog(setData);
    const updatedExerciseSets = [...completedSets, setData];
    const updatedSessionLogs = [...previousSessionLogs, setData];
    setCompletedSets(updatedExerciseSets);

    const isLastSet = updatedExerciseSets.length >= totalSets;
    const nextTarget = getSetTarget(currentSet + 1);
    const nextInfo = isLastSet
      ? { type: 'exercise', exerciseIndex: exIdx + 1, dayId }
      : { type: 'set', setNumber: currentSet + 1, exercise: exercise.name, target: nextTarget };

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
      exercise: { ...exercise, note: exerciseNote.trim() },
      isLastSet
    });

    if (currentSession?.source === 'ad_hoc' && isLastSet) {
      return;
    }

    navigate('/timer');
  }

  function addSetToCurrentExercise() {
    if (!currentSession?.sessionExercises) return;
    const previous = exercise.sets?.[exercise.sets.length - 1] || currentTarget || {};
    const nextSet = {
      setNumber: totalSets + 1,
      targetWeight: previous.targetWeight ?? previous.weight ?? weight,
      targetReps: previous.targetReps ?? previous.reps ?? reps,
      targetRIR: previous.targetRIR ?? previous.rir ?? rir
    };

    setCurrentSession({
      ...currentSession,
      sessionExercises: currentSession.sessionExercises.map((item, index) => {
        if (index !== exIdx) return item;
        const sets = [...(item.sets || []), nextSet];
        return {
          ...item,
          targetSets: sets.length,
          sets
        };
      })
    });
    setWeight(nextSet.targetWeight);
    setReps(nextSet.targetReps);
    setRIR(nextSet.targetRIR);
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
            <div className={styles.planCard}>
              <div className={styles.planHeader}>
                <span>Current target</span>
                <strong>Set {displayTarget.setNumber} of {totalSets}</strong>
              </div>
              <div className={styles.targetGrid}>
                <div className={styles.targetItem}>
                  <label>Weight</label>
                  <div className={styles.targetValue}>{displayTarget.weight}<span>kg</span></div>
                </div>
                <div className={styles.targetItem}>
                  <label>Reps</label>
                  <div className={styles.targetValue}>{displayTarget.reps}</div>
                </div>
                <div className={styles.targetItem}>
                  <label>RIR</label>
                  <div className={styles.targetValue}>{displayTarget.rir}</div>
                </div>
              </div>
              <div className={styles.upcomingTargets}>
                {upcomingTargets.length > 0 ? upcomingTargets.map(target => (
                  <div key={target.setNumber} className={styles.upcomingTarget}>
                    <span>Set {target.setNumber}</span>
                    <strong>{target.weight} kg x {target.reps}</strong>
                    <em>RIR {target.rir}</em>
                  </div>
                )) : (
                  <div className={styles.upcomingTarget}>
                    <span>Plan</span>
                    <strong>Final planned set</strong>
                    <em>Log, then move on</em>
                  </div>
                )}
              </div>
            </div>
          </div>

          {(reference.exactMatch || reference.anyMatch) && (
            <div className={styles.reference}>
              <div className={styles.referenceHeader}>
                <div>
                  <span>History</span>
                </div>
                <button className={styles.quickFillBtn} onClick={quickFillFromLast}>
                  Fill from last
                </button>
              </div>
              <div className={styles.referenceGrid}>
                {referenceItems.map(({ label, item }) => (
                  <div key={`${label}-${item.date}-${item.weight}-${item.reps}`} className={styles.referenceCard}>
                    <span>{label}</span>
                    <strong>{item.weight} kg x {item.reps}</strong>
                    <em>RIR {item.rir || '?'} - {formatLogDate(item.date)}</em>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.exerciseNotes}>
            <button className={styles.notesToggle} onClick={() => setNotesOpen(open => !open)}>
              <span>
                <strong>Set note</strong>
              </span>
              <b>{notesOpen ? 'Close' : 'Add'}</b>
            </button>
            {notesOpen && (
              <div className={styles.notesBody}>
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
              </div>
            )}
            {noteHistory.length > 0 && (
              <div className={styles.pastNotes}>
                <button className={styles.historyToggle} onClick={() => setHistoryOpen(open => !open)}>
                  <span>Past note history</span>
                  <strong>{historyOpen ? 'Hide' : `Show ${noteHistory.length}`}</strong>
                </button>
                {historyOpen && noteHistory.map((item, index) => (
                  <div key={`${item.date}-${index}`} className={styles.noteHistoryItem}>
                    <div className={styles.noteHistoryMeta}>
                      <span>{formatLogDate(item.date)}</span>
                      <span>{item.source}</span>
                      <span>Set {item.setNumber ?? '?'}</span>
                      <span>{item.weight ?? '?'} kg x {item.reps ?? '?'}</span>
                      <span>RIR {item.rir || '?'}</span>
                    </div>
                    <p>{item.text}</p>
                  </div>
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
                  <span className={styles.check} role="img" aria-label="Set complete" />
                </div>
              ))}
            </div>
          )}

          <div className={styles.inputSection}>
            <div className={styles.sectionTitle}>{targetReached ? 'Planned sets complete' : `Set ${currentSet} - Log`}</div>

            {!targetReached && <div className={styles.inputGrid}>
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
            </div>}

            {!targetReached && <div className={styles.rirSection}>
              <div className={styles.rirHeader}>
                <label className={styles.rirLabel}>RIR</label>
                {lastReference && (
                  <span>
                    Last: {lastReference.weight} kg x {lastReference.reps} @ RIR {lastReference.rir || '?'}
                  </span>
                )}
              </div>
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
            </div>}

            {!targetReached && <label className={styles.flagToggle}>
              <input
                type="checkbox"
                checked={compromisedForm}
                onChange={e => setCompromisedForm(e.target.checked)}
              />
              <span>Form compromised</span>
            </label>}
            {targetReached && (
              <button className={styles.addSetBtn} type="button" onClick={addSetToCurrentExercise}>
                Add set
              </button>
            )}
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
        {!targetReached ? (
          <button className={styles.confirmBtn} onClick={confirmSet}>
            Confirm Set
          </button>
        ) : (
          <button className={styles.confirmBtn} onClick={() => navigate('/')}>
            Back to workout
          </button>
        )}
      </div>
    </div>
  );
}
