import { openDB } from 'idb';

const DB_NAME = 'gym-tracker';
const DB_VERSION = 2;

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
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

        if (oldVersion < 2) {
          const store = transaction.objectStore('logs');
          if (!store.indexNames.contains('sessionId')) {
            store.createIndex('sessionId', 'sessionId');
          }
          if (!store.indexNames.contains('sessionExerciseId')) {
            store.createIndex('sessionExerciseId', 'sessionExerciseId');
          }
          if (!store.indexNames.contains('sessionExercise')) {
            store.createIndex('sessionExercise', ['sessionId', 'sessionExerciseId']);
          }
          if (!store.indexNames.contains('sessionSet')) {
            store.createIndex('sessionSet', ['sessionId', 'sessionExerciseId', 'setNumber']);
          }
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

export async function addLogOnce(log) {
  const db = await getDB();
  const tx = db.transaction('logs', 'readwrite');
  const key = [log.sessionId, log.sessionExerciseId, Number(log.setNumber)];
  const canIdentifySet = key[0] && key[1] && Number.isFinite(key[2]);
  const existing = canIdentifySet ? await tx.store.index('sessionSet').get(key) : null;

  if (existing) {
    await tx.done;
    return { id: existing.id, created: false, log: existing };
  }

  const id = await tx.store.add(log);
  await tx.done;
  return { id, created: true, log: { ...log, id } };
}

export async function getLogsByExercise(exerciseId) {
  const db = await getDB();
  return db.getAllFromIndex('logs', 'exerciseId', exerciseId);
}

export async function getLogsBySession(sessionId) {
  const db = await getDB();
  return db.getAllFromIndex('logs', 'sessionId', sessionId);
}

export async function getLogsBySessionExercise(sessionId, sessionExerciseId) {
  const db = await getDB();
  return db.getAllFromIndex('logs', 'sessionExercise', [sessionId, sessionExerciseId]);
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

export async function deleteLogsBySessionExercise(sessionId, sessionExerciseId) {
  const db = await getDB();
  const tx = db.transaction('logs', 'readwrite');
  let cursor = await tx.store.index('sessionExercise').openCursor([sessionId, sessionExerciseId]);
  let deleted = 0;

  while (cursor) {
    await cursor.delete();
    deleted += 1;
    cursor = await cursor.continue();
  }

  await tx.done;
  return deleted;
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
  const tx = db.transaction(['exercises', 'blocks', 'logs', 'history', 'settings'], 'readonly');
  const [exercises, blocks, logs, history, settings] = await Promise.all([
    tx.objectStore('exercises').getAll(),
    tx.objectStore('blocks').getAll(),
    tx.objectStore('logs').getAll(),
    tx.objectStore('history').getAll(),
    tx.objectStore('settings').getAll()
  ]);
  await tx.done;
  return {
    schemaVersion: 2,
    exercises,
    blocks,
    logs,
    history,
    settings,
    exportDate: new Date().toISOString()
  };
}

// === Import Full Backup ===
export async function importFullBackup(data) {
  const db = await getDB();
  validateFullBackup(data);

  const storeNames = ['exercises', 'blocks', 'logs', 'history', 'settings'];
  const tx = db.transaction(storeNames, 'readwrite');

  for (const storeName of storeNames) {
    await tx.objectStore(storeName).clear();
  }
  for (const item of data.exercises) await tx.objectStore('exercises').put(item);
  for (const item of data.blocks) await tx.objectStore('blocks').put(item);
  for (const item of data.logs) await tx.objectStore('logs').put(item);
  for (const item of data.history) await tx.objectStore('history').put(item);

  if (Array.isArray(data.settings)) {
    for (const item of data.settings) {
      if (item?.key) await tx.objectStore('settings').put(item);
    }
  } else {
    for (const [key, value] of Object.entries(data.settings)) {
      await tx.objectStore('settings').put({ key, value });
    }
  }

  await tx.done;
}

function validateFullBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Backup must be a JSON object.');
  }

  for (const key of ['exercises', 'blocks', 'logs', 'history']) {
    if (!Array.isArray(data[key])) {
      throw new Error(`Backup is missing a valid ${key} collection.`);
    }
    if (data[key].some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error(`Backup contains an invalid ${key} record.`);
    }
    const ids = data[key].filter(item => item.id !== undefined).map(item => String(item.id));
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Backup contains duplicate ${key} IDs.`);
    }
  }

  const validSettings = Array.isArray(data.settings) || (
    data.settings && typeof data.settings === 'object'
  );
  if (!validSettings) {
    throw new Error('Backup is missing valid settings.');
  }
  if (Array.isArray(data.settings)) {
    const keys = data.settings.map(item => item?.key).filter(Boolean);
    if (keys.length !== data.settings.length || new Set(keys).size !== keys.length) {
      throw new Error('Backup contains invalid or duplicate setting keys.');
    }
  }
}
