import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { getLogsByDate } from '../data/db.js';
import { normalizeRIROption } from '../data/csvImport.js';
import styles from './WorkoutScreen.module.css';

function makeSessionId() {
  return `session-${Date.now()}`;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numberOrFallback(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveTargetSets(exercise) {
  if (Array.isArray(exercise.sets) && exercise.sets.length > 0) return exercise.sets;
  if (Array.isArray(exercise.setTargets) && exercise.setTargets.length > 0) return exercise.setTargets;
  if (Array.isArray(exercise.targets) && exercise.targets.length > 0) return exercise.targets;

  return Array.from({ length: Number(exercise.targetSets) || 1 }, (_, index) => ({
    setNumber: index + 1,
    targetReps: exercise.targetReps ?? exercise.reps ?? 10,
    targetWeight: exercise.targetWeight ?? exercise.weight ?? 0,
    targetRIR: exercise.targetRIR ?? exercise.rir ?? '2'
  }));
}

function buildHistorySessions(logs = []) {
  const sessions = new Map();
  logs
    .slice()
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    .forEach(log => {
      const sessionId = log.sessionId || `date-${log.date || 'unknown'}`;
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
          sessionId,
          title: log.dayName || log.blockName || 'Workout',
          source: log.sessionSource || '',
          exercises: new Map(),
          volume: 0,
          sets: 0
        });
      }

      const session = sessions.get(sessionId);
      const exerciseKey = log.sessionExerciseId || log.exerciseName || `exercise-${session.exercises.size}`;
      if (!session.exercises.has(exerciseKey)) {
        session.exercises.set(exerciseKey, {
          name: log.exerciseName || 'Exercise',
          muscleGroup: log.muscleGroup || 'Uncategorized',
          switchedFrom: log.switchedFrom || '',
          sets: [],
          volume: 0
        });
      }

      const exercise = session.exercises.get(exerciseKey);
      const weight = numberOrFallback(log.weight, 0);
      const reps = numberOrFallback(log.reps, 0);
      const volume = weight * reps;
      exercise.sets.push(log);
      exercise.volume += volume;
      session.volume += volume;
      session.sets += 1;
    });

  return Array.from(sessions.values()).map(session => ({
    ...session,
    exercises: Array.from(session.exercises.values())
  }));
}

function snapshotExercise(exercise, overrides = {}) {
  const sets = resolveTargetSets(exercise);
  const firstSet = sets[0] || {};

  return {
    sessionExerciseId: overrides.sessionExerciseId || `session-ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceExerciseIndex: overrides.sourceExerciseIndex,
    libraryId: exercise.id || exercise.libraryId,
    name: exercise.name || 'New Exercise',
    muscleGroup: exercise.muscleGroup || 'Uncategorized',
    targetSets: sets.length,
    targetReps: numberOrFallback(firstSet.targetReps ?? firstSet.reps ?? exercise.targetReps ?? exercise.reps, 10),
    targetWeight: numberOrFallback(firstSet.targetWeight ?? firstSet.weight ?? exercise.targetWeight ?? exercise.weight, 0),
    targetRIR: normalizeRIROption(firstSet.targetRIR ?? firstSet.rir ?? exercise.targetRIR ?? exercise.rir, '2'),
    sets: sets.map((set, index) => ({
      setNumber: index + 1,
      targetReps: numberOrFallback(set.targetReps ?? set.reps, 10),
      targetWeight: numberOrFallback(set.targetWeight ?? set.weight, 0),
      targetRIR: normalizeRIROption(set.targetRIR ?? set.rir, '2')
    })),
    weightStep: optionalNumber(exercise.weightStep),
    restTimer: optionalNumber(exercise.restTimer),
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
  const [isReorderingSessionExercise, setIsReorderingSessionExercise] = useState(false);
  const [switchQueries, setSwitchQueries] = useState({});
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [historyLogs, setHistoryLogs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const longPressRef = useRef(null);
  const pendingPointerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const navigate = useNavigate();

  const today = localDateKey();
  const isToday = selectedDate === today;
  const nextDay = getNextDay();
  const sessionExercises = currentSession?.sessionExercises || [];
  const exerciseOptions = exercises
    .filter(ex => `${ex.name} ${ex.muscleGroup || ''}`.toLowerCase().includes(exerciseQuery.trim().toLowerCase()))
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name));
  const historySessions = buildHistorySessions(historyLogs);

  function withLibraryTiming(exercise) {
    const libraryExercise = exercises.find(item => (
      exercise.libraryId
        ? String(item.id) === String(exercise.libraryId)
        : String(item.name || '').trim().toLowerCase() === String(exercise.name || '').trim().toLowerCase()
    ));

    return {
      ...exercise,
      weightStep: exercise.weightStep ?? libraryExercise?.weightStep,
      restTimer: exercise.restTimer ?? libraryExercise?.restTimer
    };
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      if (isToday) {
        setHistoryLogs([]);
        return;
      }

      setHistoryLoading(true);
      try {
        const logs = await getLogsByDate(selectedDate);
        if (!cancelled) setHistoryLogs(logs);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [isToday, selectedDate]);

  useEffect(() => {
    if (!showFinishConfirm) return undefined;

    function handleShellBack(event) {
      event.preventDefault();
      setShowFinishConfirm(false);
    }

    document.addEventListener('app-shell-back', handleShellBack);
    return () => {
      document.removeEventListener('app-shell-back', handleShellBack);
    };
  }, [showFinishConfirm]);

  if (loading) return <div className={styles.viewport}><p>Loading...</p></div>;

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
      sessionExercises: nextDay.exercises.map((ex, index) => snapshotExercise(withLibraryTiming(ex), {
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
      sessionExercises: activeBlock && nextDay ? nextDay.exercises.map((ex, index) => snapshotExercise(withLibraryTiming(ex), { sourceExerciseIndex: index })) : []
    };
    const targetWeight = exercise.targetWeight ?? 0;
    const nextExercise = snapshotExercise({
      ...exercise,
      targetWeight,
      targetSets: 1,
      targetReps: 10,
      targetRIR: '2',
      weightStep: exercise.weightStep || appSettings.defaultWeightStep,
      restTimer: exercise.restTimer ?? appSettings.defaultRestTimer
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

  function cancelEmptySession() {
    const hasLogs = (currentSession?.sessionLogs || []).length > 0;
    if (!hasLogs) {
      setCurrentSession(null);
    }
  }

  function finishCurrentSession() {
    if (!currentSession) return;
    setShowFinishConfirm(true);
  }

  function confirmFinishSession() {
    if (!currentSession) return;
    setShowFinishConfirm(false);
    navigate(`/summary/${currentSession.dayId}`);
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
    if (shouldSkipReorderStart(event.target)) {
      event.preventDefault();
      return;
    }
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

  function clearPendingReorder() {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    pendingPointerRef.current = null;
  }

  function resetSessionReorder() {
    clearPendingReorder();
    setIsReorderingSessionExercise(false);
    setDraggingSessionExercise(null);
    setDragOverSessionExercise(null);
  }

  function shouldSkipReorderStart(target) {
    return Boolean(target.closest('button, select, input, textarea, a'));
  }

  function startSessionExercisePointer(event, index) {
    if (!hasActiveSession || event.button !== 0 || shouldSkipReorderStart(event.target)) return;

    const cardElement = event.currentTarget;
    clearPendingReorder();
    pendingPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      index
    };

    longPressRef.current = window.setTimeout(() => {
      setIsReorderingSessionExercise(true);
      setDraggingSessionExercise(index);
      setDragOverSessionExercise(index);
      cardElement.setPointerCapture?.(event.pointerId);
      longPressRef.current = null;
    }, 360);
  }

  function moveSessionExercisePointer(event) {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;

    if (!isReorderingSessionExercise) {
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (distance > 10) clearPendingReorder();
      return;
    }

    event.preventDefault();
    const targetCard = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-session-exercise-index]');
    if (!targetCard) return;
    const targetIndex = Number(targetCard.dataset.sessionExerciseIndex);
    if (Number.isInteger(targetIndex)) {
      setDragOverSessionExercise(targetIndex);
    }
  }

  function endSessionExercisePointer(event) {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) {
      clearPendingReorder();
      return;
    }

    if (isReorderingSessionExercise && draggingSessionExercise !== null && dragOverSessionExercise !== null) {
      event.preventDefault();
      moveSessionExercise(draggingSessionExercise, dragOverSessionExercise);
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 120);
    }

    resetSessionReorder();
  }

  function switchSessionExercise(index, libraryId) {
    const replacement = exercises.find(ex => String(ex.id) === String(libraryId));
    if (!replacement) return;
    updateSessionExercises(list => list.map((item, i) => {
      if (i !== index) return item;
      return snapshotExercise({
        ...replacement,
        weightStep: replacement.weightStep ?? appSettings.defaultWeightStep,
        restTimer: replacement.restTimer ?? appSettings.defaultRestTimer
      }, {
        sessionExerciseId: item.sessionExerciseId,
        sourceExerciseIndex: item.sourceExerciseIndex,
        baseExerciseName: item.baseExerciseName || item.name,
        switchedFrom: item.switchedFrom || item.name,
        isAdHoc: item.isAdHoc
      });
    }));
  }

  function switchSessionExerciseByName(index, value) {
    const query = String(value || '').trim().toLowerCase();
    const replacement = exercises.find(exercise => String(exercise.name || '').trim().toLowerCase() === query);
    if (!replacement) return;
    switchSessionExercise(index, replacement.id);
    setSwitchQueries(prev => ({ ...prev, [index]: '' }));
  }

  function loggedSetsFor(sessionExerciseId) {
    return (currentSession?.sessionLogs || []).filter(log => log.sessionExerciseId === sessionExerciseId).length;
  }

  const hasActiveSession = Boolean(currentSession?.sessionExercises);
  const hasSessionLogs = (currentSession?.sessionLogs || []).length > 0;
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
        <label className={styles.dateControl}>
          <span>Workout date</span>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={event => {
              setSelectedDate(event.target.value || today);
              setShowFinishConfirm(false);
            }}
          />
        </label>
      </div>

      {isToday && !activeBlock && !hasActiveSession && (
        <div className={styles.empty}>
          <h2>No Active Block</h2>
          <p>You can still start an extra session or go to Planner to create/import a training block.</p>
        </div>
      )}

      {isToday && activeBlock && !nextDay && !hasActiveSession && (
        <div className={styles.empty}>
          <h2>Block Complete</h2>
          <p>All days in this block have been completed.</p>
        </div>
      )}

      {isToday && <div className={styles.sessionActions}>
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
        {hasActiveSession && !hasSessionLogs && (
          <button className={styles.secondaryBtn} onClick={cancelEmptySession}>
            Cancel Session
          </button>
        )}
      </div>}

      {isToday && hasActiveSession && (
        <div className={styles.addPanel}>
          <input
            type="search"
            autoComplete="off"
            name="add-session-exercise"
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

      {!isToday && (
        <div className={styles.historyList}>
          {historyLoading && <div className={styles.empty}><p>Loading workout history...</p></div>}
          {!historyLoading && historySessions.length === 0 && (
            <div className={styles.empty}>
              <h2>No finished workout</h2>
              <p>No logged sets were found for this date.</p>
            </div>
          )}
          {!historyLoading && historySessions.map(session => (
            <section key={session.sessionId} className={styles.historySession}>
              <div className={styles.historySessionHeader}>
                <div>
                  <h2>{session.title}</h2>
                  <p>{session.sets} sets / {Math.round(session.volume).toLocaleString()} kg</p>
                </div>
                {session.source && <span>{session.source}</span>}
              </div>
              {session.exercises.map((exercise, index) => {
                const bestSet = exercise.sets.reduce((best, set) => {
                  const bestVolume = numberOrFallback(best?.weight, 0) * numberOrFallback(best?.reps, 0);
                  const setVolume = numberOrFallback(set.weight, 0) * numberOrFallback(set.reps, 0);
                  return setVolume > bestVolume ? set : best;
                }, exercise.sets[0]);

                return (
                  <article key={`${session.sessionId}-${exercise.name}-${index}`} className={styles.historyExercise}>
                    <div className={styles.info}>
                      <div className={styles.muscleTag}>{exercise.muscleGroup}</div>
                      <div className={styles.name}>{exercise.name}</div>
                      <div className={styles.meta}>
                        <span>{exercise.sets.length} set{exercise.sets.length === 1 ? '' : 's'}</span>
                        <span>{Math.round(exercise.volume).toLocaleString()} kg</span>
                        {bestSet && <span>Best {bestSet.weight} kg x {bestSet.reps}</span>}
                      </div>
                      {exercise.switchedFrom && <div className={styles.switchNote}>Switched from {exercise.switchedFrom}</div>}
                    </div>
                    <div className={styles.historySets}>
                      {exercise.sets.map(set => (
                        <span key={set.id || `${set.setNumber}-${set.timestamp}`}>
                          Set {set.setNumber}: {set.weight} kg x {set.reps} @ RIR {set.rir || '?'}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {isToday && <div className={styles.list}>
        {(hasActiveSession ? sessionExercises : nextDay?.exercises || []).map((ex, i) => {
          const displayExercise = hasActiveSession ? ex : snapshotExercise(ex, {
            sourceExerciseIndex: i,
            sessionExerciseId: `preview-${i}`
          });
          const loggedSets = hasActiveSession ? loggedSetsFor(displayExercise.sessionExerciseId) : 0;
          const done = hasActiveSession ? loggedSets >= displayExercise.targetSets : ex.completed;
          return (
            <div
              key={ex.sessionExerciseId || i}
              className={`${styles.card} ${isReorderingSessionExercise ? styles.reorderReady : ''} ${draggingSessionExercise === i ? styles.draggingCard : ''} ${dragOverSessionExercise === i && draggingSessionExercise !== i ? styles.dropTargetCard : ''}`}
              data-session-exercise-index={i}
              draggable={hasActiveSession}
              onDragStart={event => hasActiveSession && startSessionExerciseDrag(event, i)}
              onDragOver={event => hasActiveSession && handleSessionExerciseDragOver(event, i)}
              onDrop={event => hasActiveSession && handleSessionExerciseDrop(event, i)}
              onDragEnd={resetSessionReorder}
              onPointerDown={event => startSessionExercisePointer(event, i)}
              onPointerMove={moveSessionExercisePointer}
              onPointerUp={endSessionExercisePointer}
              onPointerCancel={resetSessionReorder}
            >
              {hasActiveSession && (
                <>
                  <button
                    className={styles.cornerRemoveBtn}
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      removeSessionExercise(i);
                    }}
                    aria-label={`Remove ${displayExercise.name}`}
                  >
                    &times;
                  </button>
                </>
              )}
              <div className={styles.exerciseItem} onClick={() => {
                if (suppressClickRef.current) return;
                hasActiveSession ? navigate(`/exercise/${currentSession.dayId}/${i}`) : startPlannedAt(i);
              }}>
                <div className={styles.info}>
                  <div className={styles.muscleTag}>{displayExercise.muscleGroup}</div>
                  <div className={styles.name}>{displayExercise.name}</div>
                  <div className={styles.meta}>
                    <span>{displayExercise.targetSets} x {displayExercise.targetReps}</span>
                    <span>{displayExercise.targetWeight} kg</span>
                    <span>RIR {displayExercise.targetRIR}</span>
                    {hasActiveSession && <span>{loggedSets} done</span>}
                  </div>
                  {displayExercise.switchedFrom && <div className={styles.switchNote}>Switched from {displayExercise.switchedFrom}</div>}
                </div>
                <div className={`${styles.indicator} ${done ? styles.done : ''}`}>
                  {done ? (
                    <span className={styles.indicatorCheck} role="img" aria-label="Exercise complete" />
                  ) : (
                    <span className={styles.indicatorCount}>{hasActiveSession ? `${loggedSets}/${displayExercise.targetSets}` : 'Plan'}</span>
                  )}
                </div>
              </div>

              {hasActiveSession && (
                <div className={styles.rowTools}>
                  <input
                    type="search"
                    autoComplete="off"
                    name={`switch-session-exercise-${i}`}
                    value={switchQueries[i] || ''}
                    onChange={event => {
                      const value = event.target.value;
                      setSwitchQueries(prev => ({ ...prev, [i]: value }));
                      switchSessionExerciseByName(i, value);
                    }}
                    placeholder="Search to switch exercise"
                  />
                  {switchQueries[i]?.trim() && (
                    <div className={styles.switchPickerList}>
                      {exercises
                        .filter(option => `${option.name} ${option.muscleGroup || ''}`.toLowerCase().includes(switchQueries[i].trim().toLowerCase()))
                        .filter(option => String(option.id) !== String(displayExercise.libraryId))
                        .slice(0, 6)
                        .map(option => (
                          <button key={option.id} type="button" onClick={() => switchSessionExerciseByName(i, option.name)}>
                            <strong>{option.name}</strong>
                            <span>{option.muscleGroup || 'Uncategorized'}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>}

      {isToday && hasActiveSession && sessionExercises.length === 0 && (
        <div className={styles.empty}>
          <h2>No Exercises</h2>
          <p>Add an exercise or finish the session.</p>
        </div>
      )}

      {isToday && hasActiveSession && (
        <div className={styles.finishActions}>
          <button className={styles.finishBtn} type="button" onClick={finishCurrentSession}>
            {currentSession.source === 'ad_hoc' ? 'Finish Extra Session' : 'Finish Workout'}
          </button>
        </div>
      )}

      {showFinishConfirm && (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="finish-confirm-title">
          <div className={styles.confirmDialog}>
            <h2 id="finish-confirm-title">
              {currentSession?.source === 'ad_hoc' ? 'Finish extra session?' : 'Finish workout?'}
            </h2>
            <p>This will open the summary. The workout is completed when you confirm the summary.</p>
            <div className={styles.confirmActions}>
              <button className={styles.secondaryBtn} type="button" onClick={() => setShowFinishConfirm(false)}>
                Cancel
              </button>
              <button className={styles.finishBtn} type="button" onClick={confirmFinishSession}>
                Finish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
