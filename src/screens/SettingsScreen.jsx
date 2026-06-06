import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { parseFitNotesCSV, importFitNotesData, exportAsCSV } from '../data/csvImport.js';
import {
  exportAllData,
  importFullBackup,
  getAllLogs,
  getAllExercises,
  getAppSettings,
  setAppSettings,
  addExercise,
  updateExercise,
  deleteExercise,
  addLog
} from '../data/db.js';
import styles from './SettingsScreen.module.css';

const DEFAULT_SETTINGS = {
  defaultRestTimer: 120,
  defaultWeightStep: 2.5
};

const EMPTY_EXERCISE_DRAFT = {
  name: '',
  muscleGroup: '',
  weightStep: '',
  restTimer: '',
  note: ''
};

const EMPTY_BACKFILL_DRAFT = {
  date: localDateKey(),
  exerciseName: '',
  setNumber: '1',
  weight: '',
  reps: '',
  rir: '2',
  note: '',
  compromisedForm: false
};

const RIR_OPTIONS = ['0', '1', '1-2', '2', '2-3', '3', '3-4'];

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

function makeMuscleGroupOptions(exercises = []) {
  const groups = new Set(COMMON_MUSCLE_GROUPS);

  exercises.forEach(exercise => {
    const group = String(exercise.muscleGroup || '').trim();
    if (group) groups.add(group);
  });

  return [...groups].sort((a, b) => a.localeCompare(b));
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function SettingsScreen() {
  const { exercises, refreshExercises, refreshBlocks, refreshSettings } = useApp();
  const [importStatus, setImportStatus] = useState('');
  const [settingsStatus, setSettingsStatus] = useState('');
  const [libraryStatus, setLibraryStatus] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [newExercise, setNewExercise] = useState(EMPTY_EXERCISE_DRAFT);
  const [editingExerciseId, setEditingExerciseId] = useState(null);
  const [editExercise, setEditExercise] = useState(EMPTY_EXERCISE_DRAFT);
  const [backfill, setBackfill] = useState(EMPTY_BACKFILL_DRAFT);
  const [backfillStatus, setBackfillStatus] = useState('');
  const fitnotesRef = useRef(null);
  const backupRef = useRef(null);
  const muscleGroupOptions = makeMuscleGroupOptions(exercises);

  useEffect(() => {
    async function loadSettings() {
      const stored = await getAppSettings();
      setSettings({
        defaultRestTimer: Number(stored.defaultRestTimer) || DEFAULT_SETTINGS.defaultRestTimer,
        defaultWeightStep: Number(stored.defaultWeightStep) || DEFAULT_SETTINGS.defaultWeightStep
      });
    }
    loadSettings();
  }, []);

  const filteredExercises = exercises
    .filter(ex => {
      const query = exerciseSearch.trim().toLowerCase();
      if (!query) return true;
      return `${ex.name} ${ex.muscleGroup || ''} ${ex.note || ex.notes || ''}`.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || (a.name || '').localeCompare(b.name || ''))
    .slice(0, 50);

  async function handleFitNotesImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImportStatus('Importing...');
    try {
      const records = await parseFitNotesCSV(file);
      const result = await importFitNotesData(records);
      await refreshExercises();
      setImportStatus(`Imported ${result.totalRecords} records, ${result.exercisesAdded} new exercises`);
    } catch (err) {
      setImportStatus('Error: ' + err.message);
    }
    e.target.value = '';
  }

  async function handleExportJSON() {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `gym-tracker-backup-${new Date().toISOString().split('T')[0]}.json`);
  }

  async function handleExportCSV() {
    const [logs, exs] = await Promise.all([getAllLogs(), getAllExercises()]);
    const csv = exportAsCSV(logs, exs);
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, `gym-tracker-export-${new Date().toISOString().split('T')[0]}.csv`);
  }

  async function handleImportBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importFullBackup(data);
      await Promise.all([refreshExercises(), refreshBlocks(), refreshSettings()]);
      const restoredSettings = await getAppSettings();
      setSettings({
        defaultRestTimer: Number(restoredSettings.defaultRestTimer) || DEFAULT_SETTINGS.defaultRestTimer,
        defaultWeightStep: Number(restoredSettings.defaultWeightStep) || DEFAULT_SETTINGS.defaultWeightStep
      });
      setImportStatus('Backup restored successfully');
    } catch (err) {
      setImportStatus('Restore failed: ' + err.message);
    }
    e.target.value = '';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function updateSettingDraft(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSettingsStatus('');
  }

  async function saveDefaults() {
    const defaultRestTimer = Math.max(0, Math.round(Number(settings.defaultRestTimer) || DEFAULT_SETTINGS.defaultRestTimer));
    const defaultWeightStep = Math.max(0.1, Number(settings.defaultWeightStep) || DEFAULT_SETTINGS.defaultWeightStep);
    const nextSettings = { defaultRestTimer, defaultWeightStep };

    await setAppSettings(nextSettings);
    await refreshSettings();
    setSettings(nextSettings);
    setSettingsStatus('Defaults saved');
  }

  async function toggleFavorite(exercise) {
    await updateExercise({ ...exercise, favorite: !exercise.favorite });
    await refreshExercises();
  }

  function updateNewExerciseDraft(key, value) {
    setNewExercise(prev => ({ ...prev, [key]: value }));
    setLibraryStatus('');
  }

  function updateEditExerciseDraft(key, value) {
    setEditExercise(prev => ({ ...prev, [key]: value }));
    setLibraryStatus('');
  }

  function updateBackfillDraft(key, value) {
    setBackfill(prev => ({ ...prev, [key]: value }));
    setBackfillStatus('');
  }

  function getDraftFromExercise(exercise) {
    return {
      name: exercise.name || '',
      muscleGroup: exercise.muscleGroup || '',
      weightStep: exercise.weightStep ?? settings.defaultWeightStep,
      restTimer: exercise.restTimer ?? settings.defaultRestTimer,
      note: exercise.note || exercise.notes || ''
    };
  }

  function normalizeExerciseDraft(draft) {
    const name = draft.name.trim();
    const muscleGroup = draft.muscleGroup.trim() || 'Uncategorized';
    const draftWeightStep = Number(draft.weightStep);
    const defaultWeightStep = Number(settings.defaultWeightStep) || DEFAULT_SETTINGS.defaultWeightStep;
    const weightStep = Math.max(0.1, Number.isFinite(draftWeightStep) && draft.weightStep !== '' ? draftWeightStep : defaultWeightStep);
    const draftRestTimer = Number(draft.restTimer);
    const defaultRestTimer = Number(settings.defaultRestTimer) || DEFAULT_SETTINGS.defaultRestTimer;
    const restTimer = Math.max(0, Math.round(Number.isFinite(draftRestTimer) && draft.restTimer !== '' ? draftRestTimer : defaultRestTimer));
    const note = draft.note.trim();

    if (!name) {
      throw new Error('Exercise name is required');
    }

    return { name, muscleGroup, weightStep, restTimer, note, notes: note };
  }

  function hasDuplicateExerciseName(name, currentId = null) {
    const normalizedName = name.trim().toLowerCase();
    return exercises.some(ex => ex.id !== currentId && (ex.name || '').trim().toLowerCase() === normalizedName);
  }

  async function handleCreateExercise(e) {
    e.preventDefault();
    try {
      const draft = normalizeExerciseDraft(newExercise);
      if (hasDuplicateExerciseName(draft.name)) {
        setLibraryStatus('An exercise with that name already exists.');
        return;
      }

      await addExercise({
        ...draft,
        favorite: false
      });
      await refreshExercises();
      setNewExercise(EMPTY_EXERCISE_DRAFT);
      setExerciseSearch('');
      setLibraryStatus(`Created ${draft.name}`);
    } catch (err) {
      setLibraryStatus(err.message);
    }
  }

  function startEditingExercise(exercise) {
    setEditingExerciseId(exercise.id);
    setEditExercise(getDraftFromExercise(exercise));
    setLibraryStatus('');
  }

  function cancelEditingExercise() {
    setEditingExerciseId(null);
    setEditExercise(EMPTY_EXERCISE_DRAFT);
    setLibraryStatus('');
  }

  async function saveEditedExercise(exercise) {
    try {
      const draft = normalizeExerciseDraft(editExercise);
      if (hasDuplicateExerciseName(draft.name, exercise.id)) {
        setLibraryStatus('An exercise with that name already exists.');
        return;
      }

      await updateExercise({ ...exercise, ...draft });
      await refreshExercises();
      setEditingExerciseId(null);
      setEditExercise(EMPTY_EXERCISE_DRAFT);
      setLibraryStatus(`Saved ${draft.name}`);
    } catch (err) {
      setLibraryStatus(err.message);
    }
  }

  async function handleDeleteExercise(exercise) {
    const confirmed = window.confirm(`Delete "${exercise.name}" from the exercise library? Existing logs are not deleted.`);
    if (!confirmed) return;

    await deleteExercise(exercise.id);
    await refreshExercises();
    if (editingExerciseId === exercise.id) {
      setEditingExerciseId(null);
      setEditExercise(EMPTY_EXERCISE_DRAFT);
    }
    setLibraryStatus(`Deleted ${exercise.name}`);
  }

  async function handleBackfillLog(e) {
    e.preventDefault();
    const exerciseName = backfill.exerciseName.trim();
    const selectedExercise = exercises.find(ex => (ex.name || '').trim().toLowerCase() === exerciseName.toLowerCase());
    const weightValue = Number(backfill.weight);
    const repsValue = Number(backfill.reps);
    const setNumber = Math.max(1, Math.round(Number(backfill.setNumber) || 1));

    if (!exerciseName) {
      setBackfillStatus('Choose an exercise before logging.');
      return;
    }
    if (!selectedExercise) {
      setBackfillStatus('Exercise must exist in the library first.');
      return;
    }
    if (!backfill.date || !Number.isFinite(new Date(`${backfill.date}T00:00:00`).getTime())) {
      setBackfillStatus('Choose a valid training date.');
      return;
    }
    if (!Number.isFinite(weightValue) || weightValue < 0 || !Number.isFinite(repsValue) || repsValue < 0) {
      setBackfillStatus('Weight and reps must be valid numbers.');
      return;
    }

    const note = backfill.note.trim();
    const timestamp = new Date(`${backfill.date}T12:00:00`).getTime();

    await addLog({
      sessionId: `backfill-${backfill.date}`,
      sessionExerciseId: `backfill-${selectedExercise.id}-${backfill.date}`,
      exerciseId: selectedExercise.id,
      exerciseName: selectedExercise.name,
      muscleGroup: selectedExercise.muscleGroup || 'Uncategorized',
      date: backfill.date,
      dayId: 'backfill',
      exerciseIndex: 0,
      setNumber,
      weight: weightValue,
      reps: repsValue,
      rir: backfill.rir,
      note,
      exerciseNote: note,
      compromisedForm: backfill.compromisedForm,
      targetWeight: weightValue,
      targetReps: repsValue,
      targetRIR: backfill.rir,
      timestamp
    });

    setBackfill(prev => ({
      ...prev,
      setNumber: String(setNumber + 1),
      weight: '',
      reps: '',
      note: '',
      compromisedForm: false
    }));
    setBackfillStatus(`Logged set ${setNumber} for ${selectedExercise.name} on ${backfill.date}.`);
  }

  return (
    <div className={styles.viewport}>
      <div className={styles.header}>
        <h1>Settings</h1>
      </div>

      <div className={styles.section}>
        <h2>Defaults</h2>
        <label className={styles.field}>
          <span>Default rest timer (seconds)</span>
          <input
            type="number"
            min="0"
            step="15"
            value={settings.defaultRestTimer}
            onChange={(e) => updateSettingDraft('defaultRestTimer', e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Default weight step (kg)</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={settings.defaultWeightStep}
            onChange={(e) => updateSettingDraft('defaultWeightStep', e.target.value)}
          />
        </label>
        <button className={styles.btn} onClick={saveDefaults}>
          Save Defaults
        </button>
        {settingsStatus && <p className={styles.status}>{settingsStatus}</p>}
      </div>

      <div className={styles.section}>
        <h2>Import</h2>
        <button className={styles.btn} onClick={() => fitnotesRef.current?.click()}>
          Import FitNotes CSV
        </button>
        <input ref={fitnotesRef} type="file" accept=".csv" onChange={handleFitNotesImport} style={{ display: 'none' }} />

        <button className={styles.btn} onClick={() => backupRef.current?.click()}>
          Restore Backup (JSON)
        </button>
        <input ref={backupRef} type="file" accept=".json" onChange={handleImportBackup} style={{ display: 'none' }} />

        {importStatus && <p className={styles.status}>{importStatus}</p>}
      </div>

      <div className={styles.section}>
        <h2>Retrospective Log</h2>
        <form className={styles.backfillForm} onSubmit={handleBackfillLog}>
          <div className={styles.formTitle}>Backfill a completed set</div>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Date</span>
              <input
                type="date"
                value={backfill.date}
                onChange={(e) => updateBackfillDraft('date', e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Exercise</span>
              <input
                type="text"
                list="backfill-exercises"
                value={backfill.exerciseName}
                onChange={(e) => updateBackfillDraft('exerciseName', e.target.value)}
                placeholder="Search library"
              />
              <datalist id="backfill-exercises">
                {exercises
                  .slice()
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                  .map(ex => (
                    <option key={ex.id} value={ex.name} />
                  ))}
              </datalist>
            </label>
            <label className={styles.field}>
              <span>Set #</span>
              <input
                type="number"
                min="1"
                step="1"
                value={backfill.setNumber}
                onChange={(e) => updateBackfillDraft('setNumber', e.target.value)}
              />
            </label>
          </div>
          <div className={styles.compactGrid}>
            <label className={styles.field}>
              <span>Weight</span>
              <input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={backfill.weight}
                onChange={(e) => updateBackfillDraft('weight', e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Reps</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={backfill.reps}
                onChange={(e) => updateBackfillDraft('reps', e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>RIR</span>
              <select
                className={styles.select}
                value={backfill.rir}
                onChange={(e) => updateBackfillDraft('rir', e.target.value)}
              >
                {RIR_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
          <label className={styles.field}>
            <span>Note</span>
            <textarea
              rows="2"
              value={backfill.note}
              onChange={(e) => updateBackfillDraft('note', e.target.value)}
              placeholder="Optional context for this set"
            />
          </label>
          <label className={styles.flagRow}>
            <input
              type="checkbox"
              checked={backfill.compromisedForm}
              onChange={(e) => updateBackfillDraft('compromisedForm', e.target.checked)}
            />
            <span>Form compromised</span>
          </label>
          <button className={styles.btn} type="submit">
            Add Retrospective Set
          </button>
          {backfillStatus && <p className={styles.status}>{backfillStatus}</p>}
        </form>
      </div>

      <div className={styles.section}>
        <h2>Export</h2>
        <button className={styles.btn} onClick={handleExportJSON}>
          Export Full Backup (JSON)
        </button>
        <button className={styles.btn} onClick={handleExportCSV}>
          Export Logs as CSV
        </button>
      </div>

      <div className={styles.section}>
        <h2>Exercise Library</h2>
        <div className={styles.sectionHeaderRow}>
          <p className={styles.meta}>{exercises.length} exercises</p>
          {libraryStatus && <p className={styles.status}>{libraryStatus}</p>}
        </div>
        <form className={styles.exerciseForm} onSubmit={handleCreateExercise}>
          <div className={styles.formTitle}>Create exercise</div>
          <label className={styles.field}>
            <span>Name</span>
            <input
              type="text"
              value={newExercise.name}
              onChange={(e) => updateNewExerciseDraft('name', e.target.value)}
              placeholder="Incline dumbbell press"
            />
          </label>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Muscle group</span>
              <input
                type="text"
                list="new-exercise-muscle-groups"
                value={newExercise.muscleGroup}
                onChange={(e) => updateNewExerciseDraft('muscleGroup', e.target.value)}
                placeholder="Chest"
              />
              <datalist id="new-exercise-muscle-groups">
                {muscleGroupOptions.map(group => (
                  <option key={group} value={group} />
                ))}
              </datalist>
            </label>
            <label className={styles.field}>
              <span>Weight step (kg)</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={newExercise.weightStep}
                onChange={(e) => updateNewExerciseDraft('weightStep', e.target.value)}
                placeholder={String(settings.defaultWeightStep)}
              />
            </label>
            <label className={styles.field}>
              <span>Rest timer (sec)</span>
              <input
                type="number"
                min="0"
                step="15"
                value={newExercise.restTimer}
                onChange={(e) => updateNewExerciseDraft('restTimer', e.target.value)}
                placeholder={String(settings.defaultRestTimer)}
              />
            </label>
          </div>
          <label className={styles.field}>
            <span>Note</span>
            <textarea
              value={newExercise.note}
              onChange={(e) => updateNewExerciseDraft('note', e.target.value)}
              placeholder="Setup, cues, or substitutions"
              rows="2"
            />
          </label>
          <button className={styles.btn} type="submit">
            Create Exercise
          </button>
        </form>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search exercises or muscle groups"
          value={exerciseSearch}
          onChange={(e) => setExerciseSearch(e.target.value)}
        />
        <div className={styles.exerciseList}>
          {filteredExercises.map(ex => (
            <div key={ex.id} className={styles.exerciseItem}>
              {editingExerciseId === ex.id ? (
                <div className={styles.editPanel}>
                  <div className={styles.itemActions}>
                    <button
                      className={`${styles.favoriteBtn} ${ex.favorite ? styles.favoriteActive : ''}`}
                      onClick={() => toggleFavorite(ex)}
                      aria-label={`${ex.favorite ? 'Unfavorite' : 'Favorite'} ${ex.name}`}
                      title={ex.favorite ? 'Favorite' : 'Not favorite'}
                      type="button"
                    >
                      {ex.favorite ? 'Fav' : 'Add'}
                    </button>
                    <button className={styles.textBtn} type="button" onClick={cancelEditingExercise}>
                      Cancel
                    </button>
                  </div>
                  <label className={styles.field}>
                    <span>Name</span>
                    <input
                      type="text"
                      value={editExercise.name}
                      onChange={(e) => updateEditExerciseDraft('name', e.target.value)}
                    />
                  </label>
                  <div className={styles.fieldGrid}>
                    <label className={styles.field}>
                      <span>Muscle group</span>
                      <input
                        type="text"
                        list={`edit-exercise-muscle-groups-${ex.id}`}
                        value={editExercise.muscleGroup}
                        onChange={(e) => updateEditExerciseDraft('muscleGroup', e.target.value)}
                      />
                      <datalist id={`edit-exercise-muscle-groups-${ex.id}`}>
                        {muscleGroupOptions.map(group => (
                          <option key={group} value={group} />
                        ))}
                      </datalist>
                    </label>
                    <label className={styles.field}>
                      <span>Weight step (kg)</span>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={editExercise.weightStep}
                        onChange={(e) => updateEditExerciseDraft('weightStep', e.target.value)}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Rest timer (sec)</span>
                      <input
                        type="number"
                        min="0"
                        step="15"
                        value={editExercise.restTimer}
                        onChange={(e) => updateEditExerciseDraft('restTimer', e.target.value)}
                      />
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span>Note</span>
                    <textarea
                      value={editExercise.note}
                      onChange={(e) => updateEditExerciseDraft('note', e.target.value)}
                      rows="2"
                    />
                  </label>
                  <div className={styles.editActions}>
                    <button className={styles.primaryBtn} type="button" onClick={() => saveEditedExercise(ex)}>
                      Save
                    </button>
                    <button className={styles.dangerBtn} type="button" onClick={() => handleDeleteExercise(ex)}>
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    className={`${styles.favoriteBtn} ${ex.favorite ? styles.favoriteActive : ''}`}
                    onClick={() => toggleFavorite(ex)}
                    aria-label={`${ex.favorite ? 'Unfavorite' : 'Favorite'} ${ex.name}`}
                    title={ex.favorite ? 'Favorite' : 'Not favorite'}
                    type="button"
                  >
                    {ex.favorite ? 'Fav' : 'Add'}
                  </button>
                  <button className={styles.exerciseSummary} type="button" onClick={() => startEditingExercise(ex)}>
                    <span className={styles.exName}>{ex.name}</span>
                    <span className={styles.exMeta}>
                      {ex.muscleGroup || 'Uncategorized'} | {ex.weightStep ?? settings.defaultWeightStep} kg | {ex.restTimer ?? settings.defaultRestTimer}s
                    </span>
                    {(ex.note || ex.notes) && <span className={styles.exNote}>{ex.note || ex.notes}</span>}
                  </button>
                  <button className={styles.textBtn} type="button" onClick={() => startEditingExercise(ex)}>
                    Edit
                  </button>
                </>
              )}
            </div>
          ))}
          {filteredExercises.length === 0 && (
            <p className={styles.meta}>No exercises match your search.</p>
          )}
          {exercises.length > filteredExercises.length && (
            <p className={styles.meta}>Showing {filteredExercises.length} of {exercises.length}</p>
          )}
        </div>
      </div>
    </div>
  );
}
