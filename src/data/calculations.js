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

function addDays(dateValue, days) {
  const date = parseDate(dateValue);
  date.setDate(date.getDate() + days);
  return formatDate(date);
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

function bestBy(logs, getValue) {
  return logs.reduce((best, log) => {
    const value = getValue(log);
    if (!Number.isFinite(value)) return best;
    if (!best || value > best.value) return { log, value };
    return best;
  }, null);
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

export function estimateWeightForReps(weight, reps, targetReps, rir = 0) {
  const safeTargetReps = Math.max(1, toNumber(targetReps));
  const e1rm = estimate1RM(weight, reps, rir);
  return round(e1rm / (1 + safeTargetReps / 30));
}

export function buildExerciseGraphData(logs, exerciseName, options = {}) {
  const metric = options.metric || 'estimated1RM';
  const selectedReps = Math.max(1, toNumber(options.selectedReps) || 1);
  const useRIR = options.useRIR !== false;
  const byDate = {};

  exerciseLogs(logs, exerciseName).forEach(log => {
    const row = ensureRow(byDate, DATE_KEY, log.date);
    const weight = toNumber(log.weight);
    const reps = toNumber(log.reps);
    const rir = useRIR ? log.rir : 0;
    const e1rm = estimate1RM(weight, reps, rir);
    const projectedWeight = estimateWeightForReps(weight, reps, selectedReps, rir);

    row.sets = (row.sets || 0) + 1;
    row.volume = round((row.volume || 0) + tonnage(weight, reps));
    row.totalReps = (row.totalReps || 0) + reps;
    row.maxWeight = Math.max(row.maxWeight || 0, weight);
    row.maxReps = Math.max(row.maxReps || 0, reps);
    row.estimated1RM = Math.max(row.estimated1RM || 0, e1rm);
    row.weightForReps = Math.max(row.weightForReps || 0, projectedWeight);
    row._rirTotal = (row._rirTotal || 0) + parseRIR(log.rir);
    row._logs = [...(row._logs || []), { ...log, e1rm, projectedWeight }];

    if (reps >= selectedReps) {
      row.actualRepMax = Math.max(row.actualRepMax || 0, weight);
    }
  });

  return createSortedRows(byDate, DATE_KEY)
    .map(({ _logs, _rirTotal, ...row }) => {
      const logsForDate = _logs || [];
      const bestSet = pickBestSet(logsForDate, metric, selectedReps);
      const value = metric === 'volume' || metric === 'totalReps'
        ? row[metric]
        : row[metric] || null;

      return {
        ...row,
        value,
        avgRIR: row.sets ? round(_rirTotal / row.sets) : 0,
        bestSet
      };
    })
    .filter(row => Number.isFinite(row.value) && row.value > 0);
}

function pickBestSet(logs, metric, selectedReps) {
  if (logs.length === 0) return null;

  const selectors = {
    estimated1RM: log => log.e1rm,
    maxWeight: log => toNumber(log.weight),
    volume: log => tonnage(log.weight, log.reps),
    totalReps: log => toNumber(log.reps),
    maxReps: log => toNumber(log.reps),
    weightForReps: log => log.projectedWeight,
    actualRepMax: log => toNumber(log.reps) >= selectedReps ? toNumber(log.weight) : -Infinity
  };

  const best = bestBy(logs, selectors[metric] || selectors.estimated1RM);
  if (!best) return null;

  return {
    exerciseName: best.log.exerciseName,
    weight: toNumber(best.log.weight),
    reps: toNumber(best.log.reps),
    rir: best.log.rir,
    setNumber: best.log.setNumber,
    note: best.log.note,
    compromisedForm: Boolean(best.log.compromisedForm),
    e1rm: best.log.e1rm,
    projectedWeight: best.log.projectedWeight
  };
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

export function buildMonthlySessionCalendar(logs, monthDate = new Date()) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = (first.getDay() + 6) % 7;
  const cells = [];
  const sessionsByDate = {};

  logs.filter(log => log?.date).forEach(log => {
    if (!sessionsByDate[log.date]) sessionsByDate[log.date] = new Set();
    sessionsByDate[log.date].add(log.sessionId || `session-${log.date}`);
  });

  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ key: `blank-${i}`, inMonth: false });
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = formatDate(new Date(year, month, day));
    const sessionCount = sessionsByDate[date]?.size || 0;
    cells.push({
      key: date,
      date,
      day,
      inMonth: true,
      sessionCount,
      hasSession: sessionCount > 0
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `blank-${cells.length}`, inMonth: false });
  }

  return cells;
}

export function inferPlannedSessionsPerWeek(appSettings = {}, activeBlock = null) {
  const settingKeys = [
    'plannedSessionsPerWeek',
    'sessionsPerWeek',
    'weeklySessions',
    'daysPerWeek'
  ];
  const fromSettings = settingKeys
    .map(key => Number(appSettings?.[key]))
    .find(value => Number.isFinite(value) && value > 0);

  if (fromSettings) return Math.round(fromSettings);

  const fromBlock = Number(activeBlock?.daysPerWeek);
  if (Number.isFinite(fromBlock) && fromBlock > 0) return Math.round(fromBlock);

  const days = Array.isArray(activeBlock?.days) ? activeBlock.days : [];
  const plannedDayNumbers = new Set(
    days
      .map(day => Number(day.dayNum || day.day || day.weekDay))
      .filter(value => Number.isFinite(value) && value > 0)
  );

  if (plannedDayNumbers.size > 0) return plannedDayNumbers.size;
  return days.length > 0 ? Math.min(days.length, 7) : 0;
}

export function buildWeeklySessionStreak(logs, plannedSessionsPerWeek) {
  const target = Math.max(0, Math.round(toNumber(plannedSessionsPerWeek)));
  if (target === 0) {
    return { current: 0, target, thisWeekSessions: 0, weeks: [] };
  }

  const sessionsByWeek = {};
  logs.filter(log => log?.date).forEach(log => {
    const week = getWeekStart(log.date);
    if (!sessionsByWeek[week]) sessionsByWeek[week] = new Set();
    sessionsByWeek[week].add(log.sessionId || `session-${log.date}`);
  });

  const todayWeek = getWeekStart(formatDate(new Date()));
  const earliestWeek = Object.keys(sessionsByWeek).sort()[0] || todayWeek;
  const weeks = [];
  let cursor = earliestWeek;

  while (String(cursor).localeCompare(todayWeek) <= 0) {
    const sessionCount = sessionsByWeek[cursor]?.size || 0;
    weeks.push({
      week: cursor,
      sessionCount,
      target,
      metTarget: sessionCount >= target
    });
    cursor = addDays(cursor, 7);
  }

  const currentWeek = weeks[weeks.length - 1];
  const streakEndIndex = currentWeek?.week === todayWeek && !currentWeek.metTarget
    ? weeks.length - 2
    : weeks.length - 1;

  let current = 0;
  for (let index = streakEndIndex; index >= 0; index -= 1) {
    if (!weeks[index]?.metTarget) break;
    current += 1;
  }

  return {
    current,
    target,
    thisWeekSessions: weeks[weeks.length - 1]?.sessionCount || 0,
    weeks
  };
}

// Find reference performance for an exercise at given RIR.
export function findReference(logs, targetRIR) {
  const sorted = [...logs].sort((a, b) => {
    const timestampDifference = Number(b.timestamp || 0) - Number(a.timestamp || 0);
    if (timestampDifference) return timestampDifference;

    const dateDifference = new Date(b.date) - new Date(a.date);
    if (dateDifference) return dateDifference;

    return Number(b.setNumber || 0) - Number(a.setNumber || 0);
  });

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
