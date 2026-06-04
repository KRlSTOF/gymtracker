import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getLogsByExercise, getHistoryByExercise, getAllLogs, addLog } from '../data/db.js';
import { findReference } from '../data/calculations.js';
import styles from './ExerciseSession.module.css';

const RIR_OPTIONS = ['0', '1', '1-2', '2', '2-3', '3', '3-4'];

export default function ExerciseSession() {
  const { dayId, exerciseIndex } = useParams();
  const navigate = useNavigate();
  const { activeBlock, currentSession, appSettings, setCurrentSession } = useApp();

  const dayIdx = parseInt(dayId);
  const exIdx = parseInt(exerciseIndex);
  const day = activeBlock?.days[dayIdx];
  const exercise = day?.exercises[exIdx];
  const sameExerciseSession = currentSession?.dayId === dayIdx && currentSession?.exerciseIndex === exIdx;
  const priorExerciseSets = sameExerciseSession ? currentSession.exerciseSets || currentSession.completedSets || [] : [];

  const [completedSets, setCompletedSets] = useState(priorExerciseSets);
  const [weight, setWeight] = useState(exercise?.targetWeight || 0);
  const [reps, setReps] = useState(exercise?.targetReps || 10);
  const [rir, setRIR] = useState(exercise?.targetRIR || '2');
  const [setNote, setSetNote] = useState('');
  const [compromisedForm, setCompromisedForm] = useState(false);
  const [reference, setReference] = useState({ exactMatch: null, anyMatch: null });
  const [sessionStart] = useState(currentSession?.dayId === dayIdx ? currentSession.sessionStart : Date.now());
  const [sessionId] = useState(currentSession?.dayId === dayIdx ? currentSession.sessionId : `session-${Date.now()}`);

  const currentSet = completedSets.length + 1;
  const totalSets = exercise?.targetSets || 3;
  const weightStep = exercise?.weightStep || appSettings.defaultWeightStep || 2.5;

  useEffect(() => {
    async function loadReference() {
      if (!exercise) return;

      if (exercise.libraryId) {
        const logs = await getLogsByExercise(exercise.libraryId);
        if (logs.length > 0) {
          setReference(findReference(logs, exercise.targetRIR));
          return;
        }
      }

      const nameMatchedLogs = (await getAllLogs()).filter(log => log.exerciseName === exercise.name);
      if (nameMatchedLogs.length > 0) {
        setReference(findReference(nameMatchedLogs, exercise.targetRIR));
        return;
      }

      const history = await getHistoryByExercise(exercise.name);
      if (history.length > 0) {
        const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
        setReference({ exactMatch: null, anyMatch: sorted[0] });
      }
    }
    loadReference();
  }, [exercise]);

  useEffect(() => {
    if (exercise) {
      setWeight(exercise.targetWeight);
      setReps(exercise.targetReps);
      setRIR(exercise.targetRIR);
      setSetNote('');
      setCompromisedForm(false);
    }
  }, [completedSets.length, exercise]);

  if (!exercise) {
    return <div className={styles.screen}><p>Exercise not found</p></div>;
  }

  const nextExercise = day?.exercises[exIdx + 1];
  const lastReference = reference.anyMatch || reference.exactMatch;

  function quickFillFromLast() {
    if (!lastReference) return;
    setWeight(Number(lastReference.weight) || 0);
    setReps(Number(lastReference.reps) || 0);
    setRIR(lastReference.rir || exercise.targetRIR || '2');
  }

  async function confirmSet() {
    const previousSessionLogs = currentSession?.dayId === dayIdx
      ? currentSession.sessionLogs || currentSession.completedSets || []
      : [];

    const setData = {
      sessionId,
      exerciseId: exercise.libraryId,
      exerciseName: exercise.name,
      muscleGroup: exercise.muscleGroup,
      date: new Date().toISOString().split('T')[0],
      dayId: dayIdx,
      exerciseIndex: exIdx,
      setNumber: currentSet,
      weight,
      reps,
      rir,
      note: setNote.trim(),
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
      ? { type: 'exercise', exerciseIndex: exIdx + 1, dayId: dayIdx }
      : { type: 'set', setNumber: currentSet + 1, exercise: exercise.name };

    setCurrentSession({
      sessionId,
      dayId: dayIdx,
      exerciseIndex: exIdx,
      exerciseSets: updatedExerciseSets,
      completedSets: updatedExerciseSets,
      sessionLogs: updatedSessionLogs,
      sessionStart,
      next: nextInfo,
      exercise,
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
          <div className={styles.headerProgress}>Set {currentSet} of {totalSets}</div>
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

          {exercise.notes && (
            <div className={styles.exerciseNotes}>
              <div className={styles.notesLabel}>Exercise notes</div>
              <p>{exercise.notes}</p>
            </div>
          )}

          {completedSets.length > 0 && (
            <div className={styles.completedSection}>
              {completedSets.map((s, i) => (
                <div key={i} className={styles.completedSet}>
                  <span>
                    Set {i + 1} - {s.weight} kg x {s.reps} @ RIR {s.rir}
                    {s.compromisedForm ? ' - form flagged' : ''}
                    {s.note ? ` - ${s.note}` : ''}
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

            <div className={styles.setMeta}>
              <label className={styles.noteLabel} htmlFor="set-note">Set note</label>
              <textarea
                id="set-note"
                rows="2"
                value={setNote}
                onChange={e => setSetNote(e.target.value)}
                placeholder="Technique, pain, setup, or cue..."
              />
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
