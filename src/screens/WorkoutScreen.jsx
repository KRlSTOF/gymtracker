import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import styles from './WorkoutScreen.module.css';

function makeSessionId() {
  return `session-${Date.now()}`;
}

function snapshotExercise(exercise, overrides = {}) {
  const sets = Array.isArray(exercise.sets) && exercise.sets.length > 0
    ? exercise.sets
    : Array.from({ length: Number(exercise.targetSets) || 1 }, (_, index) => ({
        setNumber: index + 1,
        targetReps: Number(exercise.targetReps) || 10,
        targetWeight: Number(exercise.targetWeight) || 0,
        targetRIR: exercise.targetRIR || '2'
      }));
  const firstSet = sets[0] || {};

  return {
    sessionExerciseId: overrides.sessionExerciseId || `session-ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceExerciseIndex: overrides.sourceExerciseIndex,
    libraryId: exercise.id || exercise.libraryId,
    name: exercise.name || 'New Exercise',
    muscleGroup: exercise.muscleGroup || 'Uncategorized',
    targetSets: sets.length,
    targetReps: Number(firstSet.targetReps ?? exercise.targetReps) || 10,
    targetWeight: Number(firstSet.targetWeight ?? exercise.targetWeight) || 0,
    targetRIR: firstSet.targetRIR ?? exercise.targetRIR ?? '2',
    sets: sets.map((set, index) => ({
      setNumber: index + 1,
      targetReps: Number(set.targetReps ?? set.reps) || 10,
      targetWeight: Number(set.targetWeight ?? set.weight) || 0,
      targetRIR: set.targetRIR ?? set.rir ?? '2'
    })),
    weightStep: Number(exercise.weightStep) || undefined,
    restTimer: Number(exercise.restTimer) || undefined,
    note: exercise.note || exercise.notes || '',
    baseExerciseName: overrides.baseExerciseName || exercise.baseExerciseName || exercise.name,
    switchedFrom: overrides.switchedFrom,
    isAdHoc: Boolean(overrides.isAdHoc)
  };
}

export default function WorkoutScreen() {
  const { activeBlock, currentSession, exercises, getNextDay, loading, appSettings, setCurrentSession } = useApp();
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [draggingSessionExercise, setDraggingSessionExercise] = useState(null);
  const [dragOverSessionExercise, setDragOverSessionExercise] = useState(null);
  const navigate = useNavigate();

  if (loading) return <div className={styles.viewport}><p>Loading...</p></div>;

  const nextDay = getNextDay();
  const sessionExercises = currentSession?.sessionExercises || [];
  const exerciseOptions = exercises
    .filter(ex => `${ex.name} ${ex.muscleGroup || ''}`.toLowerCase().includes(exerciseQuery.trim().toLowerCase()))
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name));

  function createPlannedSession() {
    if (!activeBlock || !nextDay) return null;
    const session = {
      sessionId: makeSessionId(),
      source: 'plan',
      dayId: nextDay.index,
      dayName: nextDay.name || `Day ${nextDay.index + 1}`,
      blockId: activeBlock.id,
      blockName: activeBlock.name,
      sessionStart: Date.now(),
      sessionLogs: [],
      sessionExercises: nextDay.exercises.map((ex, index) => snapshotExercise(ex, {
        sourceExerciseIndex: index,
        sessionExerciseId: `planned-${nextDay.index}-${index}-${Date.now()}`
      }))
    };
    setCurrentSession(session);
    return session;
  }

  function startPlannedAt(index) {
    const session = currentSession?.source === 'plan' ? currentSession : createPlannedSession(index);
    if (session?.sessionExercises[index]) {
      navigate(`/exercise/${session.dayId}/${index}`);
    }
  }

  function startExtraSession() {
    setCurrentSession({
      sessionId: makeSessionId(),
      source: 'ad_hoc',
      dayId: 'session',
      dayName: 'Extra Session',
      sessionStart: Date.now(),
      sessionLogs: [],
      sessionExercises: []
    });
  }

  function addExerciseToSession(exercise) {
    const baseSession = currentSession || {
      sessionId: makeSessionId(),
      source: activeBlock && nextDay ? 'plan' : 'ad_hoc',
      dayId: activeBlock && nextDay ? nextDay.index : 'session',
      dayName: activeBlock && nextDay ? nextDay.name || `Day ${nextDay.index + 1}` : 'Extra Session',
      blockId: activeBlock?.id,
      blockName: activeBlock?.name,
      sessionStart: Date.now(),
      sessionLogs: [],
      sessionExercises: activeBlock && nextDay ? nextDay.exercises.map((ex, index) => snapshotExercise(ex, { sourceExerciseIndex: index })) : []
    };
    const targetWeight = exercise.targetWeight ?? 0;
    const nextExercise = snapshotExercise({
      ...exercise,
      targetWeight,
      targetSets: 1,
      targetReps: 10,
      targetRIR: '2',
      weightStep: exercise.weightStep || appSettings.defaultWeightStep,
      restTimer: exercise.restTimer || appSettings.defaultRestTimer
    }, { isAdHoc: true });

    setCurrentSession({
      ...baseSession,
      sessionExercises: [...baseSession.sessionExercises, nextExercise]
    });
  }

  function updateSessionExercises(updater) {
    if (!currentSession) return;
    setCurrentSession({
      ...currentSession,
      sessionExercises: updater(currentSession.sessionExercises || [])
    });
  }

  function removeSessionExercise(index) {
    if (!currentSession) return;
    const target = currentSession.sessionExercises[index];
    setCurrentSession({
      ...currentSession,
      sessionExercises: currentSession.sessionExercises.filter((_, i) => i !== index),
      sessionLogs: (currentSession.sessionLogs || []).filter(log => log.sessionExerciseId !== target?.sessionExerciseId)
    });
  }

  function moveSessionExercise(fromIndex, toIndex) {
    updateSessionExercises(list => {
      if (toIndex < 0 || toIndex >= list.length || fromIndex === toIndex) return list;
      const copy = [...list];
      const [item] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, item);
      return copy;
    });
  }

  function startSessionExerciseDrag(event, index) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDraggingSessionExercise(index);
  }

  function handleSessionExerciseDragOver(event, index) {
    if (draggingSessionExercise === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverSessionExercise(index);
  }

  function handleSessionExerciseDrop(event, index) {
    event.preventDefault();
    if (draggingSessionExercise !== null) {
      moveSessionExercise(draggingSessionExercise, index);
    }
    setDraggingSessionExercise(null);
    setDragOverSessionExercise(null);
  }

  function switchSessionExercise(index, libraryId) {
    const replacement = exercises.find(ex => String(ex.id) === String(libraryId));
    if (!replacement) return;
    updateSessionExercises(list => list.map((item, i) => {
      if (i !== index) return item;
      return snapshotExercise({
        ...replacement,
        targetSets: item.targetSets,
        targetReps: item.targetReps,
        targetWeight: item.targetWeight,
        targetRIR: item.targetRIR,
        weightStep: replacement.weightStep || item.weightStep,
        restTimer: replacement.restTimer || item.restTimer
      }, {
        sessionExerciseId: item.sessionExerciseId,
        sourceExerciseIndex: item.sourceExerciseIndex,
        baseExerciseName: item.baseExerciseName || item.name,
        switchedFrom: item.name,
        isAdHoc: item.isAdHoc
      });
    }));
  }

  function loggedSetsFor(sessionExerciseId) {
    return (currentSession?.sessionLogs || []).filter(log => log.sessionExerciseId === sessionExerciseId).length;
  }

  const hasActiveSession = Boolean(currentSession?.sessionExercises);
  const blockProgressPercent = activeBlock?.days?.length
    ? Math.min(100, Math.round(((activeBlock.currentDayIndex || 0) / activeBlock.days.length) * 100))
    : 0;

  return (
    <div className={styles.viewport}>
      <div className={styles.header}>
        <h1>{hasActiveSession ? currentSession.dayName : nextDay ? `Day ${nextDay.index + 1} of ${activeBlock.days.length}` : 'Workout'}</h1>
        <p>
          {hasActiveSession
            ? `${currentSession.source === 'ad_hoc' ? 'Extra session' : currentSession.blockName} - adjust today only`
            : activeBlock && nextDay ? `${activeBlock.name}${nextDay.name ? ` - ${nextDay.name}` : ''}` : 'Start a planned or extra session'}
        </p>
        {activeBlock?.days?.length > 0 && (
          <div className={styles.progressWrap}>
            <div className={styles.progressRail}>
              <span style={{ width: `${blockProgressPercent}%` }} />
            </div>
            <small>{Math.min(activeBlock.currentDayIndex || 0, activeBlock.days.length)} / {activeBlock.days.length} days complete</small>
          </div>
        )}
      </div>

      {!activeBlock && !hasActiveSession && (
        <div className={styles.empty}>
          <h2>No Active Block</h2>
          <p>You can still start an extra session or go to Planner to create/import a training block.</p>
        </div>
      )}

      {activeBlock && !nextDay && !hasActiveSession && (
        <div className={styles.empty}>
          <h2>Block Complete</h2>
          <p>All days in this block have been completed.</p>
        </div>
      )}

      <div className={styles.sessionActions}>
        {nextDay && !hasActiveSession && (
          <button className={styles.primaryBtn} onClick={() => createPlannedSession()}>
            Start Planned Session
          </button>
        )}
        {!hasActiveSession && (
          <button className={styles.secondaryBtn} onClick={startExtraSession}>
            Start Extra Session
          </button>
        )}
      </div>

      {hasActiveSession && (
        <div className={styles.addPanel}>
          <input
            type="search"
            value={exerciseQuery}
            onChange={event => setExerciseQuery(event.target.value)}
            placeholder="Search library to add exercise"
          />
          <div className={styles.pickerList}>
            {exerciseOptions.slice(0, 6).map(ex => (
              <button key={ex.id} onClick={() => addExerciseToSession(ex)}>
                + {ex.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.list}>
        {(hasActiveSession ? sessionExercises : nextDay?.exercises || []).map((ex, i) => {
          const loggedSets = hasActiveSession ? loggedSetsFor(ex.sessionExerciseId) : 0;
          const done = hasActiveSession ? loggedSets >= ex.targetSets : ex.completed;
          return (
            <div
              key={ex.sessionExerciseId || i}
              className={`${styles.card} ${draggingSessionExercise === i ? styles.draggingCard : ''} ${dragOverSessionExercise === i && draggingSessionExercise !== i ? styles.dropTargetCard : ''}`}
              onDragOver={event => hasActiveSession && handleSessionExerciseDragOver(event, i)}
              onDrop={event => hasActiveSession && handleSessionExerciseDrop(event, i)}
            >
              {hasActiveSession && (
                <>
                  <button
                    className={styles.dragHandle}
                    type="button"
                    draggable
                    onDragStart={event => startSessionExerciseDrag(event, i)}
                    onDragEnd={() => {
                      setDraggingSessionExercise(null);
                      setDragOverSessionExercise(null);
                    }}
                    aria-label={`Drag ${ex.name} to reorder`}
                  >
                    Grip
                  </button>
                  <button
                    className={styles.cornerRemoveBtn}
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      removeSessionExercise(i);
                    }}
                    aria-label={`Remove ${ex.name}`}
                  >
                    x
                  </button>
                </>
              )}
              <div className={styles.exerciseItem} onClick={() => hasActiveSession ? navigate(`/exercise/${currentSession.dayId}/${i}`) : startPlannedAt(i)}>
                <div className={styles.info}>
                  <div className={styles.muscleTag}>{ex.muscleGroup}</div>
                  <div className={styles.name}>{ex.name}</div>
                  <div className={styles.meta}>
                    <span>{ex.targetSets} x {ex.targetReps}</span>
                    <span>{ex.targetWeight} kg</span>
                    <span>RIR {ex.targetRIR}</span>
                    {hasActiveSession && <span>{loggedSets} done</span>}
                  </div>
                  {ex.switchedFrom && <div className={styles.switchNote}>Switched from {ex.switchedFrom}</div>}
                </div>
                <div className={`${styles.indicator} ${done ? styles.done : ''}`}>
                  {done ? (
                    <span className={styles.indicatorCheck} role="img" aria-label="Exercise complete" />
                  ) : (
                    <span className={styles.indicatorCount}>{hasActiveSession ? `${loggedSets}/${ex.targetSets}` : 'Plan'}</span>
                  )}
                </div>
              </div>

              {hasActiveSession && (
                <div className={styles.rowTools}>
                  <select value="" onChange={event => switchSessionExercise(i, event.target.value)}>
                    <option value="">Switch...</option>
                    {exercises.map(option => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
