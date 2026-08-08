import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { formatTime } from '../data/calculations.js';
import styles from './TimerScreen.module.css';

function secondsRemaining(endsAt) {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

export default function TimerScreen() {
  const navigate = useNavigate();
  const { currentSession, appSettings, loading, setCurrentSession } = useApp();
  const [timerEndsAt, setTimerEndsAt] = useState(() => {
    const storedEndsAt = Number(currentSession?.restTimerEndsAt);
    return Number.isFinite(storedEndsAt) && storedEndsAt > 0 ? storedEndsAt : null;
  });
  const [timeLeft, setTimeLeft] = useState(() => (
    timerEndsAt ? secondsRemaining(timerEndsAt) : 0
  ));
  const intervalRef = useRef(null);
  const endedRef = useRef(false);

  const exercise = currentSession?.exercise;
  const restDuration = Math.max(0, Number(exercise?.restTimer ?? appSettings.defaultRestTimer ?? 120) || 0);

  useEffect(() => {
    if (loading) return;
    if (!currentSession) {
      navigate('/', { replace: true });
      return;
    }

    const storedEndsAt = Number(currentSession.restTimerEndsAt);
    const resolvedEndsAt = Number.isFinite(storedEndsAt) && storedEndsAt > 0
      ? storedEndsAt
      : Date.now() + restDuration * 1000;

    setTimerEndsAt(resolvedEndsAt);
    setTimeLeft(secondsRemaining(resolvedEndsAt));

    if (resolvedEndsAt !== storedEndsAt) {
      setCurrentSession(session => session ? { ...session, restTimerEndsAt: resolvedEndsAt } : session);
    }
  }, [loading, currentSession?.sessionId]);

  useEffect(() => {
    if (!timerEndsAt) return undefined;

    function updateTimer() {
      const remaining = secondsRemaining(timerEndsAt);
      setTimeLeft(remaining);
      if (remaining === 0) handleTimerEnd();
    }

    intervalRef.current = setInterval(() => {
      updateTimer();
    }, 1000);
    document.addEventListener('visibilitychange', updateTimer);
    updateTimer();

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', updateTimer);
    };
  }, [timerEndsAt]);

  function handleTimerEnd() {
    if (endedRef.current) return;
    endedRef.current = true;
    clearInterval(intervalRef.current);

    if (!currentSession) {
      navigate('/', { replace: true });
      return;
    }

    setCurrentSession(session => session ? { ...session, restTimerEndsAt: null } : session);
    const sessionExercises = currentSession.sessionExercises || [];

    if (currentSession.isLastSet) {
      const nextExIdx = currentSession.next?.exerciseIndex ?? currentSession.exerciseIndex + 1;

      if (nextExIdx < sessionExercises.length) {
        navigate(`/exercise/${currentSession.dayId}/${nextExIdx}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } else {
      navigate(`/exercise/${currentSession.dayId}/${currentSession.exerciseIndex}`, { replace: true });
    }
  }

  function skipTimer() {
    handleTimerEnd();
  }

  const nextInfo = currentSession?.next;
  const completedCount = currentSession?.exerciseSets?.length || currentSession?.completedSets?.length || 0;
  const nextTarget = nextInfo?.target;
  const nextLabel = currentSession?.isLastSet
    ? 'Next Exercise'
    : `Set ${nextInfo?.setNumber} - ${nextTarget?.weight ?? exercise?.targetWeight} kg x ${nextTarget?.reps ?? exercise?.targetReps} @ RIR ${nextTarget?.rir ?? exercise?.targetRIR}`;

  return (
    <div className={styles.screen}>
      <div className={styles.container}>
        <div className={styles.label}>Rest - {exercise?.name || 'Exercise'}</div>

        <div className={styles.circle}>
          <div className={styles.time}>{formatTime(timeLeft)}</div>
        </div>

        <div className={styles.subtitle}>
          Set {completedCount} of {exercise?.targetSets || 3} complete
        </div>

        <div className={styles.next}>{nextLabel}</div>

        <button className={styles.skipBtn} onClick={skipTimer}>
          {timerEndsAt ? 'Skip Timer' : 'Preparing Timer...'}
        </button>
      </div>
    </div>
  );
}
