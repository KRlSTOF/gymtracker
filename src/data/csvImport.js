import Papa from 'papaparse';
import { addHistoryBatch, addExercise, getExerciseByName, getAppSettings } from './db.js';

function cleanText(value) {
  return String(value ?? '').trim().replace(/^"|"$/g, '');
}

function parseNumber(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  const multiplier = 10 ** decimals;
  return Math.round(parsed * multiplier) / multiplier;
}

function firstSetTarget(exercise) {
  const first = Array.isArray(exercise.sets) ? exercise.sets[0] : null;
  return {
    targetReps: first?.targetReps ?? exercise.targetReps,
    targetWeight: first?.targetWeight ?? exercise.targetWeight,
    targetRIR: first?.targetRIR ?? exercise.targetRIR
  };
}

function parseRIRFromComment(comment) {
  const match = cleanText(comment).match(/\bRIR\s+([^|,;]+)/i);
  return match ? match[1].trim() : '';
}

function parseFitNotesRow(row) {
  const comment = cleanText(row.Comment);

  return {
    date: cleanText(row.Date),
    exerciseName: cleanText(row.Exercise),
    muscleGroup: cleanText(row.Category) || 'Uncategorized',
    weight: parseNumber(row.Weight),
    weightUnit: cleanText(row['Weight Unit']) || 'kgs',
    reps: parseInteger(row.Reps),
    rir: parseRIRFromComment(comment),
    comment
  };
}

function parseNormalizedHistoryRow(row) {
  const notes = cleanText(row.notes);

  return {
    date: cleanText(row.date),
    exerciseName: cleanText(row.exercise_name),
    muscleGroup: cleanText(row.muscle_group) || 'Uncategorized',
    weight: parseNumber(row.weight),
    weightUnit: 'kgs',
    reps: parseInteger(row.reps),
    rir: cleanText(row.rir),
    comment: notes,
    note: notes,
    notes
  };
}

function parseHistoryRow(row) {
  if (row.exercise_name || row.date) {
    return parseNormalizedHistoryRow(row);
  }
  return parseFitNotesRow(row);
}

// Parse FitNotes CSV format or normalized historical CSV format.
// FitNotes columns: Date, Exercise, Category, Weight, Weight Unit, Reps, Distance, Distance Unit, Time, Comment
// Normalized columns: date, exercise_name, muscle_group, weight, reps, rir, notes
export function parseFitNotesCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const records = results.data
          .map(parseHistoryRow)
          .filter(record => record.date && record.exerciseName);
        resolve(records);
      },
      error: (err) => reject(err)
    });
  });
}

// Import parsed records to IndexedDB
export async function importFitNotesData(records) {
  const settings = await getAppSettings();
  const defaultWeightStep = Number(settings.defaultWeightStep) || 2.5;
  const defaultRestTimer = Number(settings.defaultRestTimer) || 120;

  // Store all history
  await addHistoryBatch(records);

  // Extract unique exercises and add to library
  const uniqueExercises = new Map();
  for (const record of records) {
    if (!uniqueExercises.has(record.exerciseName)) {
      uniqueExercises.set(record.exerciseName, record.muscleGroup);
    }
  }

  let added = 0;
  for (const [name, muscleGroup] of uniqueExercises) {
    const existing = await getExerciseByName(name);
    if (!existing) {
      await addExercise({
        name,
        muscleGroup,
        weightStep: defaultWeightStep,
        restTimer: defaultRestTimer
      });
      added++;
    }
  }

  return { totalRecords: records.length, exercisesAdded: added };
}

// Export logs as CSV (FitNotes-compatible)
export function exportAsCSV(logs, exercises) {
  const rows = logs.map(log => {
    const exercise = exercises.find(e => e.id === log.exerciseId);
    const comments = [];
    if (log.rir) comments.push(`RIR ${log.rir}`);
    if (log.compromisedForm) comments.push('Form compromised');
    if (log.note) comments.push(log.note);

    return {
      Date: log.date,
      Exercise: exercise?.name || log.exerciseName || 'Unknown',
      Category: exercise?.muscleGroup || log.muscleGroup || '',
      Weight: log.weight,
      'Weight Unit': 'kgs',
      Reps: log.reps,
      Distance: '',
      'Distance Unit': '',
      Time: '',
      Comment: comments.join(' | ')
    };
  });

  return Papa.unparse(rows);
}

// Export block plan as CSV for AI consumption
export function exportBlockAsCSV(block) {
  const rows = [];
  block.days.forEach((day, dayIndex) => {
    day.exercises.forEach(ex => {
      const setTargets = Array.isArray(ex.sets) && ex.sets.length > 0
        ? ex.sets
        : Array.from({ length: Number(ex.targetSets) || 1 }, (_, index) => ({
            setNumber: index + 1,
            targetReps: ex.targetReps,
            targetWeight: ex.targetWeight,
            targetRIR: ex.targetRIR
          }));

      setTargets.forEach((set, setIndex) => {
        rows.push({
          block_name: block.name,
          week: day.week || Math.floor(dayIndex / (block.daysPerWeek || 7)) + 1,
          day: day.dayNum || (dayIndex % (block.daysPerWeek || 7)) + 1,
          day_name: day.name || '',
          exercise_name: ex.name,
          muscle_group: ex.muscleGroup,
          set_number: set.setNumber || setIndex + 1,
          target_reps: set.targetReps ?? ex.targetReps,
          target_weight: set.targetWeight ?? ex.targetWeight,
          target_rir: set.targetRIR ?? ex.targetRIR,
          notes: ex.notes || ex.note || ''
        });
      });
    });
  });

  return Papa.unparse(rows);
}

export function exportCompletedBlockAsCSV(block, logs = []) {
  const usedLogIds = new Set();
  const logsWithBlockId = logs.filter(log => String(log?.blockId || '') === String(block?.id || ''));
  const sourceLogs = logsWithBlockId.length > 0 ? logsWithBlockId : logs;
  const blockLogs = sourceLogs
    .filter(log => log?.date && log?.exerciseName)
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  function logKey(dayIndex, exerciseIndex, exerciseName, setNumber) {
    return [
      String(dayIndex),
      String(exerciseIndex),
      String(exerciseName || '').trim().toLowerCase(),
      String(setNumber)
    ].join('|');
  }

  function fallbackKey(dayIndex, exerciseIndex, setNumber) {
    return [String(dayIndex), String(exerciseIndex), String(setNumber)].join('|');
  }

  const exactLogs = new Map();
  const fallbackLogs = new Map();

  blockLogs.forEach(log => {
    const dayIndex = parseInteger(log.dayId, -1);
    const exerciseIndex = parseInteger(log.exerciseIndex, -1);
    const setNumber = parseInteger(log.setNumber, -1);
    if (dayIndex < 0 || exerciseIndex < 0 || setNumber < 1) return;

    const exact = logKey(dayIndex, exerciseIndex, log.exerciseName, setNumber);
    const fallback = fallbackKey(dayIndex, exerciseIndex, setNumber);
    if (!exactLogs.has(exact)) exactLogs.set(exact, []);
    if (!fallbackLogs.has(fallback)) fallbackLogs.set(fallback, []);
    exactLogs.get(exact).push(log);
    fallbackLogs.get(fallback).push(log);
  });

  function findMatchingLog(dayIndex, exerciseIndex, exerciseName, setNumber) {
    const exactCandidates = exactLogs.get(logKey(dayIndex, exerciseIndex, exerciseName, setNumber)) || [];
    const exact = exactCandidates.find(log => !usedLogIds.has(log.id));
    if (exact) {
      usedLogIds.add(exact.id);
      return { log: exact, matchMethod: 'day_exercise_name_set' };
    }

    const fallbackCandidates = fallbackLogs.get(fallbackKey(dayIndex, exerciseIndex, setNumber)) || [];
    const fallback = fallbackCandidates.find(log => !usedLogIds.has(log.id));
    if (fallback) {
      usedLogIds.add(fallback.id);
      return { log: fallback, matchMethod: 'day_exercise_index_set' };
    }

    return { log: null, matchMethod: 'planned_only' };
  }

  const rows = [];
  (block.days || []).forEach((day, dayIndex) => {
    (day.exercises || []).forEach((exercise, exerciseIndex) => {
      const setTargets = Array.isArray(exercise.sets) && exercise.sets.length > 0
        ? exercise.sets
        : Array.from({ length: Number(exercise.targetSets) || 1 }, (_, index) => ({
            setNumber: index + 1,
            targetReps: exercise.targetReps,
            targetWeight: exercise.targetWeight,
            targetRIR: exercise.targetRIR
          }));

      setTargets.forEach((set, setIndex) => {
        const plannedSetNumber = parseInteger(set.setNumber, setIndex + 1);
        const targetWeight = parseNumber(set.targetWeight ?? exercise.targetWeight, 0);
        const targetReps = parseInteger(set.targetReps ?? exercise.targetReps, 0);
        const targetRIR = set.targetRIR ?? exercise.targetRIR ?? '';
        const { log, matchMethod } = findMatchingLog(dayIndex, exerciseIndex, exercise.name, plannedSetNumber);
        const actualWeight = log ? parseNumber(log.weight, 0) : '';
        const actualReps = log ? parseInteger(log.reps, 0) : '';
        const actualRIR = log?.rir ?? '';

        rows.push({
          block_id: block.id ?? '',
          block_name: block.name || '',
          block_created_at: block.createdAt || '',
          block_completed: (Number(block.currentDayIndex) || 0) >= (block.days || []).length,
          week: day.week || Math.floor(dayIndex / (block.daysPerWeek || 7)) + 1,
          day: day.dayNum || (dayIndex % (block.daysPerWeek || 7)) + 1,
          day_index: dayIndex,
          day_name: day.name || '',
          deload: Boolean(day.isDeload),
          exercise_index: exerciseIndex,
          exercise_name: exercise.name || '',
          muscle_group: exercise.muscleGroup || '',
          planned_set_number: plannedSetNumber,
          target_reps: targetReps,
          target_weight: targetWeight,
          target_rir: targetRIR,
          actual_date: log?.date || '',
          session_id: log?.sessionId || '',
          session_exercise_id: log?.sessionExerciseId || '',
          actual_set_number: log?.setNumber || '',
          actual_weight: actualWeight,
          actual_reps: actualReps,
          actual_rir: actualRIR,
          volume: log ? round(actualWeight * actualReps) : '',
          weight_delta: log ? round(actualWeight - targetWeight) : '',
          reps_delta: log ? actualReps - targetReps : '',
          rir_delta: log && actualRIR !== '' && targetRIR !== '' ? round(parseNumber(actualRIR, 0) - parseNumber(targetRIR, 0)) : '',
          completed: Boolean(log),
          compromised_form: Boolean(log?.compromisedForm),
          switched_from: log?.switchedFrom || '',
          notes: log?.note || log?.exerciseNote || exercise.notes || exercise.note || '',
          match_method: matchMethod,
          log_id: log?.id || ''
        });
      });
    });
  });

  return Papa.unparse(rows);
}

// Import block from CSV (AI-generated plan)
export function parseBlockCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.filter(r => r.exercise_name);
        
        // Group by day and exercise, preserving per-set targets when set_number exists.
        const daysMap = new Map();
        rows.forEach(row => {
          const dayKey = `${row.week}-${row.day}`;
          if (!daysMap.has(dayKey)) {
            daysMap.set(dayKey, {
              name: row.day_name || `Week ${row.week} Day ${row.day}`,
              week: parseInt(row.week) || 1,
              dayNum: parseInt(row.day) || 1,
              exercises: []
            });
          }

          const day = daysMap.get(dayKey);
          const exerciseName = row.exercise_name.trim();
          const existing = day.exercises.find(exercise => exercise.name.toLowerCase() === exerciseName.toLowerCase());
          const setTarget = {
            setNumber: parseInteger(row.set_number, existing ? existing.sets.length + 1 : 1),
            targetReps: parseInteger(row.target_reps, 10),
            targetWeight: parseNumber(row.target_weight, 0),
            targetRIR: row.target_rir?.trim() || '2'
          };

          if (existing) {
            existing.sets.push(setTarget);
            existing.sets.sort((a, b) => a.setNumber - b.setNumber);
            existing.targetSets = existing.sets.length;
            Object.assign(existing, firstSetTarget(existing));
          } else {
            day.exercises.push({
              name: exerciseName,
              muscleGroup: row.muscle_group?.trim() || '',
              targetSets: parseInteger(row.target_sets, 1),
              targetReps: setTarget.targetReps,
              targetWeight: setTarget.targetWeight,
              targetRIR: setTarget.targetRIR,
              sets: [setTarget],
              notes: row.notes || ''
            });
          }
        });

        daysMap.forEach(day => {
          day.exercises = day.exercises.map(exercise => {
            const sets = (exercise.sets || []).sort((a, b) => a.setNumber - b.setNumber);
            const targets = firstSetTarget({ ...exercise, sets });
            return {
              ...exercise,
              ...targets,
              targetSets: sets.length || parseInteger(exercise.targetSets, 1),
              sets
            };
          });
        });

        const days = Array.from(daysMap.values())
          .sort((a, b) => a.week - b.week || a.dayNum - b.dayNum);

        resolve({
          name: rows[0]?.block_name || 'Imported Block',
          days
        });
      },
      error: reject
    });
  });
}
