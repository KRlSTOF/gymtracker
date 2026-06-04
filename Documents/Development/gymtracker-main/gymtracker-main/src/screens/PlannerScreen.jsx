import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { addBlock, deleteBlock, updateBlock } from '../data/db.js';
import { parseBlockCSV } from '../data/csvImport.js';
import styles from './PlannerScreen.module.css';

export default function PlannerScreen() {
  const { blocks, activeBlock, refreshBlocks, setActiveBlockById } = useApp();
  const [importing, setImporting] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState(null);
  const fileRef = useRef(null);

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const parsed = await parseBlockCSV(file);
      const block = {
        name: parsed.name,
        days: parsed.days,
        currentDayIndex: 0,
        createdAt: new Date().toISOString()
      };
      await addBlock(block);
      await refreshBlocks();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    setImporting(false);
    e.target.value = '';
  }

  async function activateBlock(id) {
    await setActiveBlockById(id);
  }

  async function removeBlock(id) {
    if (confirm('Delete this block?')) {
      await deleteBlock(id);
      await refreshBlocks();
    }
  }

  async function duplicateBlock(block) {
    const copy = JSON.parse(JSON.stringify(block));
    delete copy.id;
    copy.name = `${block.name} Copy`;
    copy.currentDayIndex = 0;
    copy.createdAt = new Date().toISOString();
    copy.days = (copy.days || []).map(day => ({
      ...day,
      exercises: day.exercises || []
    }));

    await addBlock(copy);
    await refreshBlocks();
  }

  async function toggleDeloadDay(block, dayIndex) {
    const updated = {
      ...block,
      days: block.days.map((day, i) => (
        i === dayIndex ? { ...day, isDeload: !day.isDeload } : day
      ))
    };

    await updateBlock(updated);
    await refreshBlocks();
    if (activeBlock?.id === block.id) {
      await setActiveBlockById(block.id);
    }
  }

  return (
    <div className={styles.viewport}>
      <div className={styles.header}>
        <h1>Planner</h1>
        <p>Import and manage training blocks</p>
      </div>

      <div className={styles.actions}>
        <button className={styles.importBtn} onClick={() => fileRef.current?.click()}>
          {importing ? 'Importing...' : 'Import Block CSV'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleImport}
          style={{ display: 'none' }}
        />
      </div>

      <div className={styles.blockList}>
        {blocks.length === 0 && (
          <div className={styles.emptyState}>
            <p>No blocks yet. Import a CSV to get started.</p>
          </div>
        )}

        {blocks.map(block => (
          <div key={block.id} className={styles.blockCard}>
            <div className={styles.blockHeader} onClick={() => setExpandedBlock(expandedBlock === block.id ? null : block.id)}>
              <div className={styles.blockInfo}>
                <div className={styles.blockName}>{block.name}</div>
                <div className={styles.blockMeta}>
                  {block.days.length} days - Day {(block.currentDayIndex || 0) + 1} of {block.days.length}
                </div>
              </div>
              <div className={styles.blockActions}>
                {activeBlock?.id === block.id ? (
                  <span className={styles.activeBadge}>Active</span>
                ) : (
                  <button className={styles.activateBtn} onClick={(e) => { e.stopPropagation(); activateBlock(block.id); }}>
                    Activate
                  </button>
                )}
              </div>
            </div>

            {expandedBlock === block.id && (
              <div className={styles.blockExpanded}>
                {block.days.map((day, i) => (
                  <div key={i} className={`${styles.dayItem} ${i < (block.currentDayIndex || 0) ? styles.dayDone : ''}`}>
                    <div className={styles.dayHeader}>
                      <div className={styles.dayLabel}>
                        Day {i + 1}{day.name ? ` - ${day.name}` : ''}
                        {day.isDeload && <span className={styles.deloadBadge}>Deload</span>}
                      </div>
                      <button
                        className={`${styles.deloadBtn} ${day.isDeload ? styles.deloadActive : ''}`}
                        onClick={() => toggleDeloadDay(block, i)}
                      >
                        {day.isDeload ? 'Unset Deload' : 'Set Deload'}
                      </button>
                    </div>
                    <div className={styles.dayExercises}>
                      {day.exercises.map((ex, j) => (
                        <div key={j} className={styles.dayExercise}>
                          {ex.name} - {ex.targetSets}x{ex.targetReps} @ {ex.targetWeight}kg RIR {ex.targetRIR}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <button className={styles.duplicateBtn} onClick={() => duplicateBlock(block)}>
                  Duplicate Block
                </button>
                <button className={styles.deleteBtn} onClick={() => removeBlock(block.id)}>
                  Delete Block
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
