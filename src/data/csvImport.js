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
      rows.push({
        block_name: block.name,
        week: Math.floor(dayIndex / block.daysPerWeek) + 1,
        day: (dayIndex % block.daysPerWeek) + 1,
        day_name: day.name || '',
        exercise_name: ex.name,
        muscle_group: ex.muscleGroup,
        target_sets: ex.targetSets,
        target_reps: ex.targetReps,
        target_weight: ex.targetWeight,
        target_rir: ex.targetRIR,
        notes: ex.notes || ''
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
        
        // Group by day
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
          daysMap.get(dayKey).exercises.push({
            name: row.exercise_name.trim(),
            muscleGroup: row.muscle_group?.trim() || '',
            targetSets: parseInt(row.target_sets) || 3,
            targetReps: parseInt(row.target_reps) || 10,
            targetWeight: parseFloat(row.target_weight) || 0,
            targetRIR: row.target_rir?.trim() || '2',
            notes: row.notes || ''
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
