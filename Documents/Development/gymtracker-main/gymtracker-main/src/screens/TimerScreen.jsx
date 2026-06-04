import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { formatTime } from '../data/calculations.js';
import styles from './TimerScreen.module.css';

export default function TimerScreen() {
  const navigate = useNavigate();
  const { currentSession, activeBlock, appSettings } = useApp();
  const [timeLeft, setTimeLeft] = useState(0);
  const intervalRef = useRef(null);

  const exercise = currentSession?.exercise;
  const restDuration = exercise?.restTimer || appSettings.defaultRestTimer || 120;

  useEffect(() => {
    setTimeLeft(restDuration);

    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          handleTimerEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, []);

  function handleTimerEnd() {
    if (!currentSession) {
      navigate('/');
      return;
    }

    const { next, dayId } = currentSession;

    if (currentSession.isLastSet) {
      const day = activeBlock?.days[dayId];
      const nextExIdx = next.exerciseIndex;

      if (day && nextExIdx < day.exercises.length) {
        navigate(`/exercise/${dayId}/${nextExIdx}`);
      } else {
        navigate(`/summary/${dayId}`);
      }
    } else {
      navigate(`/exercise/${dayId}/${currentSession.exerciseIndex}`);
    }
  }

  function skipTimer() {
    clearInterval(intervalRef.current);
    handleTimerEnd();
  }

  const nextInfo = currentSession?.next;
  const completedCount = currentSession?.exerciseSets?.length || currentSession?.completedSets?.length || 0;
  const nextLabel = currentSession?.isLastSet
    ? 'Next Exercise'
    : `Set ${nextInfo?.setNumber} - ${exercise?.targetWeight} kg x ${exercise?.targetReps} @ RIR ${exercise?.targetRIR}`;

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
          Skip Timer
        </button>
      </div>
    </div>
  );
}
