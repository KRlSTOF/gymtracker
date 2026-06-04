import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import styles from './WorkoutScreen.module.css';

export default function WorkoutScreen() {
  const { activeBlock, getNextDay, loading } = useApp();
  const navigate = useNavigate();

  if (loading) return <div className={styles.viewport}><p>Loading...</p></div>;

  const nextDay = getNextDay();

  if (!activeBlock) {
    return (
      <div className={styles.viewport}>
        <div className={styles.empty}>
          <h2>No Active Block</h2>
          <p>Go to Planner to create or import a training block.</p>
        </div>
      </div>
    );
  }

  if (!nextDay) {
    return (
      <div className={styles.viewport}>
        <div className={styles.empty}>
          <h2>Block Complete</h2>
          <p>All days in this block have been completed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.viewport}>
      <div className={styles.header}>
        <h1>Day {nextDay.index + 1} of {activeBlock.days.length}</h1>
        <p>{activeBlock.name}{nextDay.name ? ` — ${nextDay.name}` : ''}</p>
      </div>

      <div className={styles.list}>
        {nextDay.exercises.map((ex, i) => (
          <div
            key={i}
            className={styles.card}
            onClick={() => navigate(`/exercise/${nextDay.index}/${i}`)}
          >
            <div className={styles.exerciseItem}>
              <div className={styles.info}>
                <div className={styles.muscleTag}>{ex.muscleGroup}</div>
                <div className={styles.name}>{ex.name}</div>
                <div className={styles.meta}>
                  <span>{ex.targetSets} × {ex.targetReps}</span>
                  <span>{ex.targetWeight} kg</span>
                  <span>RIR {ex.targetRIR}</span>
                </div>
              </div>
              <div className={`${styles.indicator} ${ex.completed ? styles.done : ''}`}>
                {ex.completed ? '✓' : '–'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
