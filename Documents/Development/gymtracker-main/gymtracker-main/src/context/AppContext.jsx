import { createContext, useContext, useState, useEffect } from 'react';
import * as db from '../data/db.js';

const AppContext = createContext(null);
const DEFAULT_APP_SETTINGS = {
  defaultRestTimer: 120,
  defaultWeightStep: 2.5
};

export function useApp() {
  return useContext(AppContext);
}

export function AppProvider({ children }) {
  const [exercises, setExercises] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [activeBlock, setActiveBlock] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [appSettings, setAppSettingsState] = useState(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Load initial data
  useEffect(() => {
    async function init() {
      const [exs, blks, activeBlockId, storedSettings] = await Promise.all([
        db.getAllExercises(),
        db.getAllBlocks(),
        db.getSetting('activeBlockId'),
        db.getAppSettings()
      ]);
      setExercises(exs);
      setBlocks(blks);
      setAppSettingsState(normalizeSettings(storedSettings));
      if (activeBlockId) {
        const block = await db.getBlock(activeBlockId);
        setActiveBlock(block);
      }
      setLoading(false);
    }
    init();
  }, []);

  // Refresh exercises
  async function refreshExercises() {
    setExercises(await db.getAllExercises());
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
  async function completeDay() {
    if (!activeBlock) return;
    const updated = {
      ...activeBlock,
      currentDayIndex: (activeBlock.currentDayIndex || 0) + 1
    };
    await db.updateBlock(updated);
    setActiveBlock(updated);
    setBlocks(prev => prev.map(block => block.id === updated.id ? updated : block));
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
