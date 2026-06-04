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
  updateExercise
} from '../data/db.js';
import styles from './SettingsScreen.module.css';

const DEFAULT_SETTINGS = {
  defaultRestTimer: 120,
  defaultWeightStep: 2.5
};

export default function SettingsScreen() {
  const { exercises, refreshExercises, refreshBlocks, refreshSettings } = useApp();
  const [importStatus, setImportStatus] = useState('');
  const [settingsStatus, setSettingsStatus] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const fitnotesRef = useRef(null);
  const backupRef = useRef(null);

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
      return `${ex.name} ${ex.muscleGroup || ''}`.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name))
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
        <p className={styles.meta}>{exercises.length} exercises</p>
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
              <button
                className={`${styles.favoriteBtn} ${ex.favorite ? styles.favoriteActive : ''}`}
                onClick={() => toggleFavorite(ex)}
                aria-label={`${ex.favorite ? 'Unfavorite' : 'Favorite'} ${ex.name}`}
                title={ex.favorite ? 'Favorite' : 'Not favorite'}
              >
                {ex.favorite ? 'Fav' : 'Add'}
              </button>
              <span className={styles.exName}>{ex.name}</span>
              <span className={styles.exGroup}>{ex.muscleGroup}</span>
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
