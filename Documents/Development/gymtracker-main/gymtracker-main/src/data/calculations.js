const DATE_KEY = 'date';
const WEEK_KEY = 'week';

function round(value, decimals = 1) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRIRLabel(rir) {
  if (rir === undefined || rir === null || rir === '') return 'RIR ?';
  return `RIR ${String(rir).trim()}`;
}

function parseDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year || 0, (month || 1) - 1, day || 1);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart(dateValue) {
  const date = parseDate(dateValue);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return formatDate(date);
}

function createSortedRows(map, keyName) {
  return Object.values(map).sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));
}

function ensureRow(map, keyName, keyValue) {
  if (!map[keyValue]) map[keyValue] = { [keyName]: keyValue };
  return map[keyValue];
}

function validLog(log) {
  return log?.date && toNumber(log.reps) > 0;
}

function logTonnage(log) {
  return tonnage(log.weight, log.reps);
}

function exerciseLogs(logs, exerciseName) {
  return logs.filter(log => validLog(log) && log.exerciseName === exerciseName);
}

// Epley formula for estimated 1RM.
export function estimate1RM(weight, reps, rir = 0) {
  const safeWeight = toNumber(weight);
  const effectiveReps = toNumber(reps) + parseRIR(rir);
  if (effectiveReps <= 1) return safeWeight;
  return round(safeWeight * (1 + effectiveReps / 30));
}

// Parse RIR string to number (e.g., "2-3" -> 2.5).
export function parseRIR(rir) {
  if (typeof rir === 'number') return Number.isFinite(rir) ? rir : 0;
  const str = String(rir ?? '').trim();
  if (str.includes('-')) {
    const values = str.split('-').map(Number).filter(Number.isFinite);
    if (values.length === 2) return (values[0] + values[1]) / 2;
  }
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Calculate tonnage for a set.
export function tonnage(weight, reps) {
  return round(toNumber(weight) * toNumber(reps));
}

export function buildDailyExerciseMetrics(logs, exerciseName) {
  const byDate = {};

  exerciseLogs(logs, exerciseName).forEach(log => {
    const row = ensureRow(byDate, DATE_KEY, log.date);
    const e1rm = estimate1RM(log.weight, log.reps, log.rir);

    row.sets = (row.sets || 0) + 1;
    row.volume = round((row.volume || 0) + logTonnage(log));
    row.e1rm = Math.max(row.e1rm || 0, e1rm);
    row._rirTotal = (row._rirTotal || 0) + parseRIR(log.rir);
  });

  return createSortedRows(byDate, DATE_KEY).map(({ _rirTotal, ...row }) => ({
    ...row,
    avgRIR: row.sets ? round(_rirTotal / row.sets) : 0
  }));
}

export function buildDailyVolumeByRIR(logs, exerciseName) {
  const byDate = {};

  exerciseLogs(logs, exerciseName).forEach(log => {
    const row = ensureRow(byDate, DATE_KEY, log.date);
    const rirKey = normalizeRIRLabel(log.rir);
    row[rirKey] = round((row[rirKey] || 0) + logTonnage(log));
  });

  return createSortedRows(byDate, DATE_KEY);
}

export function buildDailyOneRepMaxByRIR(logs, exerciseName) {
  const byDate = {};

  exerciseLogs(logs, exerciseName).forEach(log => {
    const row = ensureRow(byDate, DATE_KEY, log.date);
    const rirKey = normalizeRIRLabel(log.rir);
    row[rirKey] = Math.max(row[rirKey] || 0, estimate1RM(log.weight, log.reps, log.rir));
  });

  return createSortedRows(byDate, DATE_KEY);
}

export function buildWeeklyMuscleGroupTonnage(logs) {
  const byWeek = {};

  logs.filter(validLog).forEach(log => {
    const row = ensureRow(byWeek, WEEK_KEY, getWeekStart(log.date));
    const muscleGroup = log.muscleGroup || 'Uncategorized';
    row[muscleGroup] = round((row[muscleGroup] || 0) + logTonnage(log));
  });

  return createSortedRows(byWeek, WEEK_KEY);
}

export function buildWeeklySetDensity(logs) {
  const byWeek = {};

  logs.filter(validLog).forEach(log => {
    const row = ensureRow(byWeek, WEEK_KEY, getWeekStart(log.date));
    const muscleGroup = log.muscleGroup || 'Uncategorized';
    row[muscleGroup] = (row[muscleGroup] || 0) + 1;
  });

  return createSortedRows(byWeek, WEEK_KEY);
}

export function buildWeeklyTonnage(logs) {
  const byWeek = {};

  logs.filter(validLog).forEach(log => {
    const row = ensureRow(byWeek, WEEK_KEY, getWeekStart(log.date));
    row.tonnage = round((row.tonnage || 0) + logTonnage(log));
  });

  return createSortedRows(byWeek, WEEK_KEY);
}

export function buildWeeklyAverageRIR(logs) {
  const byWeek = {};

  logs.filter(validLog).forEach(log => {
    const row = ensureRow(byWeek, WEEK_KEY, getWeekStart(log.date));
    row._rirTotal = (row._rirTotal || 0) + parseRIR(log.rir);
    row._sets = (row._sets || 0) + 1;
  });

  return createSortedRows(byWeek, WEEK_KEY).map(({ _rirTotal, _sets, ...row }) => ({
    ...row,
    avgRIR: _sets ? round(_rirTotal / _sets) : 0
  }));
}

// Find reference performance for an exercise at given RIR.
export function findReference(logs, targetRIR) {
  const sorted = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date));

  const exactMatch = sorted.find(l => l.rir === targetRIR);
  const anyMatch = sorted[0];

  return { exactMatch, anyMatch };
}

// Find reference from historical (FitNotes) data.
export function findHistoricalReference(history, exerciseName) {
  const matches = history
    .filter(h => h.exerciseName.toLowerCase() === exerciseName.toLowerCase())
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return matches[0] || null;
}

// Format time from seconds.
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
