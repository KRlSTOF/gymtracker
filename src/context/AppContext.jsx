import { createContext, useCallback, useContext, useState, useEffect } from 'react';
import * as db from '../data/db.js';

const AppContext = createContext(null);
const DEFAULT_APP_SETTINGS = {
  defaultRestTimer: 120,
  defaultWeightStep: 2.5
};
const ACTIVE_SESSION_STORAGE_KEY = 'gym-tracker-active-session';

function loadLocalSession() {
  try {
    const value = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function saveLocalSession(session) {
  try {
    if (session) {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  } catch {
    // IndexedDB remains the fallback when localStorage is unavailable.
  }
}

export function useApp() {
  return useContext(AppContext);
}

export function AppProvider({ children }) {
  const [exercises, setExercises] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [activeBlock, setActiveBlock] = useState(null);
  const [currentSession, setCurrentSessionState] = useState(loadLocalSession);
  const [appSettings, setAppSettingsState] = useState(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Load initial data
  useEffect(() => {
    async function init() {
      const [exs, blks, activeBlockId, storedSettings, storedSession] = await Promise.all([
        db.getAllExercises(),
        db.getAllBlocks(),
        db.getSetting('activeBlockId'),
        db.getAppSettings(),
        db.getSetting('currentSession')
      ]);
      setExercises(exs);
      setBlocks(blks);
      setAppSettingsState(normalizeSettings(storedSettings));
      setCurrentSessionState(current => current || storedSession || null);
      if (activeBlockId) {
        const block = await db.getBlock(activeBlockId);
        setActiveBlock(block);
      }
      setLoading(false);
    }
    init();
  }, []);

  const setCurrentSession = useCallback(nextSession => {
    setCurrentSessionState(previousSession => {
      const resolvedSession = typeof nextSession === 'function'
        ? nextSession(previousSession)
        : nextSession;
      saveLocalSession(resolvedSession);
      db.setSetting('currentSession', resolvedSession || null).catch(() => {});
      return resolvedSession;
    });
  }, []);

  // Refresh exercises
  async function refreshExercises() {
    const nextExercises = await db.getAllExercises();
    setExercises(nextExercises);
    setCurrentSession(prev => reconcileSessionExerciseSettings(prev, nextExercises));
  }

  // Refresh blocks
  async function refreshBlocks() {
    const [blks, activeBlockId] = await Promise.all([
      db.getAllBlocks(),
      db.getSetting('activeBlockId')
    ]);
    setBlocks(blks);
    if (activeBlockId) {
      setActiveBlock(await db.getBlock(activeBlockId) || null);
    } else {
      setActiveBlock(null);
    }
  }

  async function refreshSettings() {
    const storedSettings = await db.getAppSettings();
    setAppSettingsState(normalizeSettings(storedSettings));
  }

  async function restoreCurrentSession() {
    const storedSession = await db.getSetting('currentSession') || null;
    saveLocalSession(storedSession);
    setCurrentSessionState(storedSession);
    return storedSession;
  }

  // Set active block
  async function setActiveBlockById(id) {
    await db.setSetting('activeBlockId', id);
    const block = await db.getBlock(id);
    setActiveBlock(block);
  }

  // Get next day in queue
  function getNextDay() {
    if (!activeBlock) return null;
    const nextIndex = activeBlock.currentDayIndex || 0;
    if (nextIndex >= activeBlock.days.length) return null;
    return { ...activeBlock.days[nextIndex], index: nextIndex };
  }

  // Mark day complete and advance
  async function completeDay(blockId, expectedDayIndex) {
    if (blockId === undefined || blockId === null) {
      throw new Error('This session is not linked to a training block.');
    }
    const block = await db.getBlock(blockId);
    if (!block) {
      throw new Error('The training block for this session no longer exists.');
    }

    const currentDayIndex = Number(block.currentDayIndex) || 0;
    const expectedIndex = Number(expectedDayIndex);
    if (Number.isFinite(expectedIndex)) {
      if (currentDayIndex > expectedIndex) return block;
      if (currentDayIndex < expectedIndex) {
        throw new Error('The training block position changed before this session was completed.');
      }
    }

    const updated = {
      ...block,
      currentDayIndex: Math.min(currentDayIndex + 1, block.days?.length ?? currentDayIndex + 1)
    };
    await db.updateBlock(updated);
    setActiveBlock(current => String(current?.id) === String(updated.id) ? updated : current);
    setBlocks(prev => prev.map(block => String(block.id) === String(updated.id) ? updated : block));
    return updated;
  }

  const value = {
    exercises,
    blocks,
    activeBlock,
    currentSession,
    appSettings,
    loading,
    setCurrentSession,
    clearCurrentSession: () => setCurrentSession(null),
    refreshExercises,
    refreshBlocks,
    refreshSettings,
    restoreCurrentSession,
    setActiveBlockById,
    getNextDay,
    completeDay
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

function normalizeSettings(settings = {}) {
  return {
    defaultRestTimer: Number(settings.defaultRestTimer) || DEFAULT_APP_SETTINGS.defaultRestTimer,
    defaultWeightStep: Number(settings.defaultWeightStep) || DEFAULT_APP_SETTINGS.defaultWeightStep
  };
}

function reconcileSessionExerciseSettings(session, exercises = []) {
  if (!session?.sessionExercises?.length) return session;

  const byId = new Map(exercises.map(exercise => [String(exercise.id), exercise]));
  let changed = false;
  const sessionExercises = session.sessionExercises.map(sessionExercise => {
    const libraryExercise = sessionExercise.libraryId ? byId.get(String(sessionExercise.libraryId)) : null;
    if (!libraryExercise) return sessionExercise;

    const libraryRestTimer = Number(libraryExercise.restTimer);
    const libraryWeightStep = Number(libraryExercise.weightStep);
    const nextRestTimer = Number.isFinite(libraryRestTimer) ? libraryRestTimer : sessionExercise.restTimer;
    const nextWeightStep = Number.isFinite(libraryWeightStep) ? libraryWeightStep : sessionExercise.weightStep;
    if (nextRestTimer === sessionExercise.restTimer && nextWeightStep === sessionExercise.weightStep) {
      return sessionExercise;
    }

    changed = true;
    return {
      ...sessionExercise,
      restTimer: nextRestTimer,
      weightStep: nextWeightStep
    };
  });

  if (!changed) return session;

  const exercise = session.exercise?.sessionExerciseId
    ? sessionExercises.find(item => item.sessionExerciseId === session.exercise.sessionExerciseId) || session.exercise
    : session.exercise;

  return {
    ...session,
    sessionExercises,
    exercise
  };
}
