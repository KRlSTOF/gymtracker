import { openDB } from 'idb';

const DB_NAME = 'gym-tracker';
const DB_VERSION = 1;

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Exercise Library
        if (!db.objectStoreNames.contains('exercises')) {
          const store = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
          store.createIndex('muscleGroup', 'muscleGroup');
          store.createIndex('name', 'name');
        }

        // Training Blocks
        if (!db.objectStoreNames.contains('blocks')) {
          db.createObjectStore('blocks', { keyPath: 'id', autoIncrement: true });
        }

        // Workout Logs (per set)
        if (!db.objectStoreNames.contains('logs')) {
          const store = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          store.createIndex('exerciseId', 'exerciseId');
          store.createIndex('date', 'date');
          store.createIndex('exerciseDate', ['exerciseId', 'date']);
        }

        // Historical Logs (FitNotes import)
        if (!db.objectStoreNames.contains('history')) {
          const store = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          store.createIndex('exerciseName', 'exerciseName');
          store.createIndex('date', 'date');
        }

        // Settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      }
    });
  }
  return dbPromise;
}

// === Exercise Library ===
export async function getAllExercises() {
  const db = await getDB();
  return db.getAll('exercises');
}

export async function addExercise(exercise) {
  const db = await getDB();
  return db.add('exercises', exercise);
}

export async function updateExercise(exercise) {
  const db = await getDB();
  return db.put('exercises', exercise);
}

export async function deleteExercise(id) {
  const db = await getDB();
  return db.delete('exercises', id);
}

export async function getExerciseByName(name) {
  const db = await getDB();
  const all = await db.getAllFromIndex('exercises', 'name', name);
  return all[0] || null;
}

// === Training Blocks ===
export async function getAllBlocks() {
  const db = await getDB();
  return db.getAll('blocks');
}

export async function getBlock(id) {
  const db = await getDB();
  return db.get('blocks', id);
}

export async function addBlock(block) {
  const db = await getDB();
  return db.add('blocks', block);
}

export async function updateBlock(block) {
  const db = await getDB();
  return db.put('blocks', block);
}

export async function deleteBlock(id) {
  const db = await getDB();
  return db.delete('blocks', id);
}

// === Workout Logs ===
export async function addLog(log) {
  const db = await getDB();
  return db.add('logs', log);
}

export async function getLogsByExercise(exerciseId) {
  const db = await getDB();
  return db.getAllFromIndex('logs', 'exerciseId', exerciseId);
}

export async function getLogsByDate(date) {
  const db = await getDB();
  return db.getAllFromIndex('logs', 'date', date);
}

export async function getAllLogs() {
  const db = await getDB();
  return db.getAll('logs');
}

export async function updateLog(log) {
  const db = await getDB();
  return db.put('logs', log);
}

// === Historical Logs ===
export async function addHistoryBatch(records) {
  const db = await getDB();
  const tx = db.transaction('history', 'readwrite');
  for (const record of records) {
    tx.store.add(record);
  }
  await tx.done;
}

export async function getHistoryByExercise(exerciseName) {
  const db = await getDB();
  return db.getAllFromIndex('history', 'exerciseName', exerciseName);
}

export async function getAllHistory() {
  const db = await getDB();
  return db.getAll('history');
}

export async function clearHistory() {
  const db = await getDB();
  return db.clear('history');
}

// === Settings ===
export async function getSetting(key) {
  const db = await getDB();
  const result = await db.get('settings', key);
  return result?.value;
}

export async function setSetting(key, value) {
  const db = await getDB();
  return db.put('settings', { key, value });
}

export async function getAllSettings() {
  const db = await getDB();
  return db.getAll('settings');
}

export async function getAppSettings() {
  const rows = await getAllSettings();
  return rows.reduce((settings, row) => {
    settings[row.key] = row.value;
    return settings;
  }, {});
}

export async function setAppSettings(settings) {
  const db = await getDB();
  const tx = db.transaction('settings', 'readwrite');
  for (const [key, value] of Object.entries(settings || {})) {
    tx.store.put({ key, value });
  }
  await tx.done;
}

// === Export All Data ===
export async function exportAllData() {
  const db = await getDB();
  return {
    exercises: await db.getAll('exercises'),
    blocks: await db.getAll('blocks'),
    logs: await db.getAll('logs'),
    history: await db.getAll('history'),
    settings: await db.getAll('settings'),
    exportDate: new Date().toISOString()
  };
}

// === Import Full Backup ===
export async function importFullBackup(data) {
  const db = await getDB();
  if (data.exercises) {
    const tx = db.transaction('exercises', 'readwrite');
    await tx.store.clear();
    for (const item of data.exercises) tx.store.add(item);
    await tx.done;
  }
  if (data.blocks) {
    const tx = db.transaction('blocks', 'readwrite');
    await tx.store.clear();
    for (const item of data.blocks) tx.store.add(item);
    await tx.done;
  }
  if (data.logs) {
    const tx = db.transaction('logs', 'readwrite');
    await tx.store.clear();
    for (const item of data.logs) tx.store.add(item);
    await tx.done;
  }
  if (data.history) {
    const tx = db.transaction('history', 'readwrite');
    await tx.store.clear();
    for (const item of data.history) tx.store.add(item);
    await tx.done;
  }
  if (data.settings) {
    const tx = db.transaction('settings', 'readwrite');
    await tx.store.clear();
    if (Array.isArray(data.settings)) {
      for (const item of data.settings) {
        if (item?.key) tx.store.put(item);
      }
    } else {
      for (const [key, value] of Object.entries(data.settings)) {
        tx.store.put({ key, value });
      }
    }
    await tx.done;
  }
}
