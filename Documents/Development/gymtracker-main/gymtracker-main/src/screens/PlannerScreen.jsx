import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { addBlock, deleteBlock, updateBlock } from '../data/db.js';
import { parseBlockCSV } from '../data/csvImport.js';
import styles from './PlannerScreen.module.css';

const EMPTY_EXERCISE = {
  name: 'New Exercise',
  muscleGroup: '',
  targetSets: 3,
  targetReps: 10,
  targetWeight: 0,
  targetRIR: '2',
  note: '',
  notes: ''
};

const COMMON_MUSCLE_GROUPS = [
  'Abs',
  'Back',
  'Biceps',
  'Calves',
  'Cardio',
  'Chest',
  'Core',
  'Forearms',
  'Full Body',
  'Glutes',
  'Hamstrings',
  'Lower Body',
  'Quads',
  'Shoulders',
  'Triceps',
  'Upper Body',
  'Uncategorized'
];

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moveItem(items, fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function makeMuscleGroupOptions(exercises = [], blocks = []) {
  const groups = new Set(COMMON_MUSCLE_GROUPS);

  exercises.forEach(exercise => {
    const group = String(exercise.muscleGroup || '').trim();
    if (group) groups.add(group);
  });

  blocks.forEach(block => {
    (block.days || []).forEach(day => {
      (day.exercises || []).forEach(exercise => {
        const group = String(exercise.muscleGroup || '').trim();
        if (group) groups.add(group);
      });
    });
  });

  return [...groups].sort((a, b) => a.localeCompare(b));
}

function makeDay(index = 0) {
  return {
    name: `Day ${index + 1}`,
    week: Math.floor(index / 7) + 1,
    dayNum: (index % 7) + 1,
    isDeload: false,
    exercises: []
  };
}

function normalizeExercise(exercise = {}) {
  const note = String(exercise.note ?? exercise.notes ?? '');

  return {
    ...exercise,
    name: String(exercise.name || 'New Exercise'),
    muscleGroup: String(exercise.muscleGroup || ''),
    targetSets: toInt(exercise.targetSets, 3),
    targetReps: toInt(exercise.targetReps, 10),
    targetWeight: toNumber(exercise.targetWeight, 0),
    targetRIR: String(exercise.targetRIR ?? '2'),
    note,
    notes: note
  };
}

function normalizeDay(day = {}, index = 0) {
  return {
    ...day,
    name: String(day.name || `Day ${index + 1}`),
    week: toInt(day.week, Math.floor(index / 7) + 1),
    dayNum: toInt(day.dayNum, (index % 7) + 1),
    isDeload: Boolean(day.isDeload),
    exercises: (day.exercises || []).map(normalizeExercise)
  };
}

function normalizeBlock(block = {}) {
  const days = (block.days || []).map(normalizeDay);
  const maxDayIndex = Math.max(0, days.length - 1);
  const currentDayIndex = Math.min(toInt(block.currentDayIndex, 0), maxDayIndex);

  return {
    ...block,
    name: String(block.name || 'Untitled Block'),
    days,
    currentDayIndex,
    createdAt: block.createdAt || new Date().toISOString()
  };
}

function sanitizeBlockForSave(block) {
  const normalized = normalizeBlock(block);
  return {
    ...normalized,
    name: String(normalized.name).trim() || 'Untitled Block',
    days: normalized.days.map((day, index) => ({
      ...day,
      name: String(day.name).trim() || `Day ${index + 1}`,
      exercises: day.exercises.map(exercise => {
        const note = String(exercise.note ?? exercise.notes ?? '');
        return {
          ...exercise,
          name: String(exercise.name).trim() || 'New Exercise',
          muscleGroup: String(exercise.muscleGroup).trim(),
          targetSets: Math.max(0, toInt(exercise.targetSets, 0)),
          targetReps: Math.max(0, toInt(exercise.targetReps, 0)),
          targetWeight: Math.max(0, toNumber(exercise.targetWeight, 0)),
          targetRIR: String(exercise.targetRIR ?? '').trim(),
          note: note.trim(),
          notes: note.trim()
        };
      })
    }))
  };
}

export default function PlannerScreen() {
  const { blocks, activeBlock, exercises, refreshBlocks, setActiveBlockById } = useApp();
  const [draftBlocks, setDraftBlocks] = useState([]);
  const [importing, setImporting] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState(undefined);
  const [savingId, setSavingId] = useState(null);
  const [selectedDayByBlock, setSelectedDayByBlock] = useState({});
  const [draggingExercise, setDraggingExercise] = useState(null);
  const [dragOverExercise, setDragOverExercise] = useState(null);
  const fileRef = useRef(null);
  const muscleGroupOptions = makeMuscleGroupOptions(exercises, draftBlocks);

  useEffect(() => {
    const nextDrafts = blocks.map(normalizeBlock);
    setDraftBlocks(nextDrafts);
    setExpandedBlock(prev => {
      if (prev === null) return null;
      if (nextDrafts.some(block => block.id === prev)) return prev;
      return activeBlock?.id || nextDrafts[0]?.id || null;
    });
    setSelectedDayByBlock(prev => {
      const next = {};

      nextDrafts.forEach(block => {
        const maxIndex = Math.max(0, block.days.length - 1);
        const savedIndex = toInt(prev[block.id], block.currentDayIndex || 0);
        next[block.id] = clamp(savedIndex, 0, maxIndex);
      });

      return next;
    });
  }, [activeBlock?.id, blocks]);

  function setDraftBlock(blockId, updater) {
    setDraftBlocks(prev => prev.map(block => {
      if (block.id !== blockId) return block;
      return typeof updater === 'function' ? updater(block) : updater;
    }));
  }

  async function persistBlock(block) {
    const cleanBlock = sanitizeBlockForSave(block);
    setSavingId(cleanBlock.id);
    try {
      await updateBlock(cleanBlock);
      await refreshBlocks();
    } finally {
      setSavingId(null);
    }
  }

  async function persistDraft(blockId) {
    const draft = draftBlocks.find(block => block.id === blockId);
    if (draft) {
      await persistBlock(draft);
    }
  }

  async function updateDraftAndPersist(blockId, updater) {
    const draft = draftBlocks.find(block => block.id === blockId);
    if (!draft) return;

    const updated = normalizeBlock(updater(copy(draft)));
    setDraftBlock(blockId, updated);
    await persistBlock(updated);
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    setImporting(true);
    try {
      const parsed = await parseBlockCSV(file);
      const block = normalizeBlock({
        name: parsed.name,
        days: parsed.days,
        currentDayIndex: 0,
        createdAt: new Date().toISOString()
      });
      const id = await addBlock(block);
      await refreshBlocks();
      setExpandedBlock(id);
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function createBlock() {
    const block = normalizeBlock({
      name: `Training Block ${blocks.length + 1}`,
      days: [makeDay(0)],
      currentDayIndex: 0,
      createdAt: new Date().toISOString()
    });

    const id = await addBlock(block);
    await refreshBlocks();
    setExpandedBlock(id);
  }

  async function activateBlock(id) {
    await setActiveBlockById(id);
    await refreshBlocks();
  }

  async function removeBlock(id) {
    if (!confirm('Delete this block?')) return;

    await deleteBlock(id);
    await refreshBlocks();
    setExpandedBlock(prev => prev === id ? null : prev);
  }

  async function duplicateBlock(block) {
    const duplicate = sanitizeBlockForSave(copy(block));
    delete duplicate.id;
    duplicate.name = `${duplicate.name} Copy`;
    duplicate.currentDayIndex = 0;
    duplicate.createdAt = new Date().toISOString();

    const id = await addBlock(duplicate);
    await refreshBlocks();
    setExpandedBlock(id);
  }

  function updateBlockField(blockId, field, value) {
    setDraftBlock(blockId, block => ({
      ...block,
      [field]: value
    }));
  }

  function updateDayField(blockId, dayIndex, field, value) {
    setDraftBlock(blockId, block => ({
      ...block,
      days: block.days.map((day, index) => (
        index === dayIndex ? { ...day, [field]: value } : day
      ))
    }));
  }

  function updateExerciseField(blockId, dayIndex, exerciseIndex, field, value) {
    setDraftBlock(blockId, block => ({
      ...block,
      days: block.days.map((day, index) => {
        if (index !== dayIndex) return day;

        return {
          ...day,
          exercises: day.exercises.map((exercise, exIndex) => {
            if (exIndex !== exerciseIndex) return exercise;
            const updated = { ...exercise, [field]: value };
            if (field === 'note') updated.notes = value;
            return updated;
          })
        };
      })
    }));
  }

  async function addDay(blockId) {
    const draft = draftBlocks.find(block => block.id === blockId);
    if (draft) {
      setSelectedDayByBlock(prev => ({ ...prev, [blockId]: draft.days.length }));
    }

    await updateDraftAndPersist(blockId, block => ({
      ...block,
      days: [...block.days, makeDay(block.days.length)]
    }));
  }

  async function removeDay(blockId, dayIndex) {
    const draft = draftBlocks.find(block => block.id === blockId);
    const maxIndexAfterRemoval = Math.max(0, (draft?.days.length ?? 1) - 2);

    setSelectedDayByBlock(prev => {
      const currentIndex = toInt(prev[blockId], 0);
      const nextIndex = currentIndex > dayIndex ? currentIndex - 1 : Math.min(currentIndex, maxIndexAfterRemoval);
      return { ...prev, [blockId]: nextIndex };
    });

    await updateDraftAndPersist(blockId, block => ({
      ...block,
      days: block.days.filter((_, index) => index !== dayIndex),
      currentDayIndex: Math.min(block.currentDayIndex || 0, Math.max(0, block.days.length - 2))
    }));
  }

  async function moveDay(blockId, dayIndex, direction) {
    setSelectedDayByBlock(prev => ({ ...prev, [blockId]: dayIndex + direction }));
    await updateDraftAndPersist(blockId, block => ({
      ...block,
      days: moveItem(block.days, dayIndex, dayIndex + direction)
    }));
  }

  async function toggleDeload(blockId, dayIndex) {
    await updateDraftAndPersist(blockId, block => ({
      ...block,
      days: block.days.map((day, index) => (
        index === dayIndex ? { ...day, isDeload: !day.isDeload } : day
      ))
    }));
  }

  async function addExercise(blockId, dayIndex) {
    await updateDraftAndPersist(blockId, block => ({
      ...block,
      days: block.days.map((day, index) => (
        index === dayIndex
          ? { ...day, exercises: [...day.exercises, { ...EMPTY_EXERCISE }] }
          : day
      ))
    }));
  }

  async function removeExercise(blockId, dayIndex, exerciseIndex) {
    await updateDraftAndPersist(blockId, block => ({
      ...block,
      days: block.days.map((day, index) => (
        index === dayIndex
          ? { ...day, exercises: day.exercises.filter((_, exIndex) => exIndex !== exerciseIndex) }
          : day
      ))
    }));
  }

  function selectDay(blockId, dayIndex) {
    setSelectedDayByBlock(prev => ({ ...prev, [blockId]: dayIndex }));
  }

  function isDraggingExercise(blockId, dayIndex, exerciseIndex) {
    return draggingExercise?.blockId === blockId &&
      draggingExercise?.dayIndex === dayIndex &&
      draggingExercise?.exerciseIndex === exerciseIndex;
  }

  function isDragTarget(blockId, dayIndex, exerciseIndex) {
    return dragOverExercise?.blockId === blockId &&
      dragOverExercise?.dayIndex === dayIndex &&
      dragOverExercise?.exerciseIndex === exerciseIndex &&
      !isDraggingExercise(blockId, dayIndex, exerciseIndex);
  }

  function startExerciseDrag(event, blockId, dayIndex, exerciseIndex) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${blockId}:${dayIndex}:${exerciseIndex}`);
    setDraggingExercise({ blockId, dayIndex, exerciseIndex });
  }

  function handleExerciseDragOver(event, blockId, dayIndex, exerciseIndex) {
    if (draggingExercise?.blockId !== blockId || draggingExercise?.dayIndex !== dayIndex) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverExercise({ blockId, dayIndex, exerciseIndex });
  }

  async function handleExerciseDrop(event, blockId, dayIndex, exerciseIndex) {
    event.preventDefault();

    const source = draggingExercise;
    setDraggingExercise(null);
    setDragOverExercise(null);

    if (!source || source.blockId !== blockId || source.dayIndex !== dayIndex || source.exerciseIndex === exerciseIndex) {
      return;
    }

    await updateDraftAndPersist(blockId, block => ({
      ...block,
      days: block.days.map((day, index) => (
        index === dayIndex
          ? { ...day, exercises: moveItem(day.exercises, source.exerciseIndex, exerciseIndex) }
          : day
      ))
    }));
  }

  function endExerciseDrag() {
    setDraggingExercise(null);
    setDragOverExercise(null);
  }

  return (
    <div className={styles.viewport}>
      <section className={styles.hero}>
        <div>
          <h1>Planner</h1>
        </div>

        <div className={styles.heroActions}>
          <button className={styles.primaryBtn} onClick={createBlock}>
            New block
          </button>
          <button className={styles.secondaryBtn} onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importing...' : 'Import CSV'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleImport}
            className={styles.hiddenInput}
          />
        </div>
      </section>

      <section className={styles.summaryStrip}>
        <div>
          <span>{draftBlocks.length}</span>
          <small>Blocks</small>
        </div>
        <div>
          <span>{activeBlock ? activeBlock.name : 'None'}</span>
          <small>Active</small>
        </div>
      </section>

      <section className={styles.blockList}>
        {draftBlocks.length === 0 && (
          <div className={styles.emptyState}>
            <h2>No blocks yet</h2>
            <p>Create a block manually or import a CSV plan to start editing.</p>
          </div>
        )}

        {draftBlocks.map(block => {
          const isExpanded = expandedBlock === block.id;
          const isActive = activeBlock?.id === block.id;
          const exerciseCount = block.days.reduce((total, day) => total + day.exercises.length, 0);
          const selectedDayIndex = clamp(toInt(selectedDayByBlock[block.id], block.currentDayIndex || 0), 0, Math.max(0, block.days.length - 1));
          const selectedDay = block.days[selectedDayIndex];

          return (
            <article key={block.id} className={`${styles.blockCard} ${isActive ? styles.activeCard : ''}`}>
              <header className={styles.blockHeader}>
                <button
                  className={styles.blockToggle}
                  onClick={() => setExpandedBlock(isExpanded ? null : block.id)}
                  aria-expanded={isExpanded}
                >
                  <span className={styles.blockTitle}>{block.name}</span>
                  <span className={styles.blockMeta}>
                    {block.days.length} days / {exerciseCount} exercises
                  </span>
                </button>

                <div className={styles.blockStatus}>
                  {savingId === block.id && <span className={styles.savingBadge}>Saving</span>}
                  {isActive && <span className={styles.activeBadge}>Active</span>}
                </div>
              </header>

              {isExpanded && (
                <div className={styles.editor}>
                  <label className={styles.fieldWide}>
                    <span>Block name</span>
                    <input
                      value={block.name}
                      onChange={e => updateBlockField(block.id, 'name', e.target.value)}
                      onBlur={() => persistDraft(block.id)}
                      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </label>

                  <div className={styles.actionGrid}>
                    <button className={styles.secondaryBtn} onClick={() => addDay(block.id)}>
                      Add day
                    </button>
                    <button className={styles.secondaryBtn} onClick={() => duplicateBlock(block)}>
                      Duplicate
                    </button>
                    <button className={styles.secondaryBtn} onClick={() => activateBlock(block.id)} disabled={isActive}>
                      {isActive ? 'Active block' : 'Activate'}
                    </button>
                    <button className={styles.dangerBtn} onClick={() => removeBlock(block.id)}>
                      Delete
                    </button>
                  </div>

                  <div className={styles.days}>
                    {block.days.length === 0 && (
                      <div className={styles.emptyDay}>
                        <p>This block has no days.</p>
                        <button className={styles.secondaryBtn} onClick={() => addDay(block.id)}>
                          Add first day
                        </button>
                      </div>
                    )}

                    {block.days.length > 0 && (
                      <>
                        <div className={styles.dayTabs} aria-label={`${block.name} days`}>
                          {block.days.map((day, dayIndex) => (
                            <button
                              key={`${block.id}-tab-${dayIndex}`}
                              type="button"
                              className={`${styles.dayTab} ${selectedDayIndex === dayIndex ? styles.dayTabActive : ''}`}
                              onClick={() => selectDay(block.id, dayIndex)}
                              aria-pressed={selectedDayIndex === dayIndex}
                            >
                              <span>{day.name || `Day ${dayIndex + 1}`}</span>
                              <small>W{day.week} D{day.dayNum}{day.isDeload ? ' / Deload' : ''}</small>
                            </button>
                          ))}
                        </div>

                        <section className={styles.dayCard}>
                        <div className={styles.dayTopline}>
                          <div>
                            <span className={styles.dayEyebrow}>Week {selectedDay.week} / Day {selectedDay.dayNum}</span>
                            <h2>{selectedDay.name}</h2>
                          </div>
                          {selectedDay.isDeload && <span className={styles.deloadBadge}>Deload</span>}
                        </div>

                        <div className={styles.dayFields}>
                          <label>
                            <span>Day name</span>
                            <input
                              value={selectedDay.name}
                              onChange={e => updateDayField(block.id, selectedDayIndex, 'name', e.target.value)}
                              onBlur={() => persistDraft(block.id)}
                            />
                          </label>
                          <label>
                            <span>Week</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={selectedDay.week}
                              onChange={e => updateDayField(block.id, selectedDayIndex, 'week', e.target.value)}
                              onBlur={() => persistDraft(block.id)}
                            />
                          </label>
                          <label>
                            <span>Day #</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={selectedDay.dayNum}
                              onChange={e => updateDayField(block.id, selectedDayIndex, 'dayNum', e.target.value)}
                              onBlur={() => persistDraft(block.id)}
                            />
                          </label>
                        </div>

                        <div className={styles.rowActions}>
                          <button onClick={() => moveDay(block.id, selectedDayIndex, -1)} disabled={selectedDayIndex === 0}>
                            Move up
                          </button>
                          <button onClick={() => moveDay(block.id, selectedDayIndex, 1)} disabled={selectedDayIndex === block.days.length - 1}>
                            Move down
                          </button>
                          <button
                            className={selectedDay.isDeload ? styles.warningActive : ''}
                            onClick={() => toggleDeload(block.id, selectedDayIndex)}
                          >
                            {selectedDay.isDeload ? 'Unset deload' : 'Set deload'}
                          </button>
                          <button className={styles.dangerTextBtn} onClick={() => removeDay(block.id, selectedDayIndex)}>
                            Remove day
                          </button>
                        </div>

                        <div className={styles.exerciseList}>
                          <div className={styles.exerciseHeader}>
                            <h3>Exercises</h3>
                            <button className={styles.smallPrimaryBtn} onClick={() => addExercise(block.id, selectedDayIndex)}>
                              Add exercise
                            </button>
                          </div>

                          {selectedDay.exercises.length === 0 && (
                            <p className={styles.emptyExercises}>No exercises yet.</p>
                          )}

                          {selectedDay.exercises.map((exercise, exerciseIndex) => (
                            <div
                              key={`${block.id}-${selectedDayIndex}-${exerciseIndex}`}
                              className={`${styles.exerciseCard} ${isDraggingExercise(block.id, selectedDayIndex, exerciseIndex) ? styles.exerciseDragging : ''} ${isDragTarget(block.id, selectedDayIndex, exerciseIndex) ? styles.exerciseDropTarget : ''}`}
                              onDragOver={event => handleExerciseDragOver(event, block.id, selectedDayIndex, exerciseIndex)}
                              onDrop={event => handleExerciseDrop(event, block.id, selectedDayIndex, exerciseIndex)}
                            >
                              <div className={styles.exerciseCardHeader}>
                                <button
                                  className={styles.dragHandle}
                                  type="button"
                                  draggable
                                  onDragStart={event => startExerciseDrag(event, block.id, selectedDayIndex, exerciseIndex)}
                                  onDragEnd={endExerciseDrag}
                                  aria-label={`Drag ${exercise.name} to reorder`}
                                  title="Drag to reorder"
                                >
                                  Grip
                                </button>
                                <span className={styles.exercisePosition}>Exercise {exerciseIndex + 1}</span>
                              </div>

                              <label className={styles.fieldWide}>
                                <span>Exercise name</span>
                                <input
                                  value={exercise.name}
                                  onChange={e => updateExerciseField(block.id, selectedDayIndex, exerciseIndex, 'name', e.target.value)}
                                  onBlur={() => persistDraft(block.id)}
                                />
                              </label>

                              <div className={styles.exerciseGrid}>
                                <label>
                                  <span>Sets</span>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    value={exercise.targetSets}
                                    onChange={e => updateExerciseField(block.id, selectedDayIndex, exerciseIndex, 'targetSets', e.target.value)}
                                    onBlur={() => persistDraft(block.id)}
                                  />
                                </label>
                                <label>
                                  <span>Reps</span>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    value={exercise.targetReps}
                                    onChange={e => updateExerciseField(block.id, selectedDayIndex, exerciseIndex, 'targetReps', e.target.value)}
                                    onBlur={() => persistDraft(block.id)}
                                  />
                                </label>
                                <label>
                                  <span>Weight</span>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.5"
                                    value={exercise.targetWeight}
                                    onChange={e => updateExerciseField(block.id, selectedDayIndex, exerciseIndex, 'targetWeight', e.target.value)}
                                    onBlur={() => persistDraft(block.id)}
                                  />
                                </label>
                                <label>
                                  <span>RIR</span>
                                  <input
                                    value={exercise.targetRIR}
                                    onChange={e => updateExerciseField(block.id, selectedDayIndex, exerciseIndex, 'targetRIR', e.target.value)}
                                    onBlur={() => persistDraft(block.id)}
                                  />
                                </label>
                              </div>

                              <label className={styles.fieldWide}>
                                <span>Muscle group</span>
                                <input
                                  list={`planner-muscle-groups-${block.id}-${selectedDayIndex}-${exerciseIndex}`}
                                  value={exercise.muscleGroup}
                                  onChange={e => updateExerciseField(block.id, selectedDayIndex, exerciseIndex, 'muscleGroup', e.target.value)}
                                  onBlur={() => persistDraft(block.id)}
                                  placeholder="Chest, Back, Quads..."
                                />
                                <datalist id={`planner-muscle-groups-${block.id}-${selectedDayIndex}-${exerciseIndex}`}>
                                  {muscleGroupOptions.map(group => (
                                    <option key={group} value={group} />
                                  ))}
                                </datalist>
                              </label>

                              <label className={styles.fieldWide}>
                                <span>Note</span>
                                <textarea
                                  rows="2"
                                  value={exercise.note}
                                  onChange={e => updateExerciseField(block.id, selectedDayIndex, exerciseIndex, 'note', e.target.value)}
                                  onBlur={() => persistDraft(block.id)}
                                  placeholder="Setup cues, substitutions, tempo, or constraints..."
                                />
                              </label>

                              <div className={styles.rowActions}>
                                <button
                                  className={styles.dangerTextBtn}
                                  onClick={() => removeExercise(block.id, selectedDayIndex, exerciseIndex)}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                      </>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
