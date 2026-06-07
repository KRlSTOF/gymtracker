import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useApp } from '../context/AppContext.jsx';
import { getAllHistory, getAllLogs } from '../data/db.js';
import {
  buildExerciseGraphData,
  buildMonthlySessionCalendar,
  buildWeeklySessionStreak,
  buildWeeklyAverageRIR,
  buildWeeklyMuscleGroupTonnage,
  buildWeeklySetDensity,
  buildWeeklyTonnage,
  inferPlannedSessionsPerWeek
} from '../data/calculations.js';
import styles from './AnalyticsScreen.module.css';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'];
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -16 };
const EXERCISE_CHART_MARGIN = { top: 10, right: 18, bottom: 0, left: -8 };
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const ALL_MUSCLE_GROUPS = 'all';
const PERIOD_OPTIONS = [
  { value: '1y', label: 'Past Year', years: 1 },
  { value: '2y', label: 'Past 2 Years', years: 2 },
  { value: 'all', label: 'All Time', years: null }
];
const GRAPH_METRICS = [
  {
    value: 'estimated1RM',
    label: 'Estimated 1RM',
    unit: 'kg',
    description: 'Best daily Epley estimate. RIR can be included.'
  },
  {
    value: 'maxWeight',
    label: 'Max weight',
    unit: 'kg',
    description: 'Heaviest set logged that day.'
  },
  {
    value: 'volume',
    label: 'Workout volume',
    unit: 'kg',
    description: 'Total weight x reps for the selected exercise.'
  },
  {
    value: 'totalReps',
    label: 'Total reps',
    unit: 'reps',
    description: 'Total completed reps for the selected exercise.'
  },
  {
    value: 'maxReps',
    label: 'Max reps',
    unit: 'reps',
    description: 'Highest reps in a single set.'
  },
  {
    value: 'weightForReps',
    label: 'Weight for selected reps',
    unit: 'kg',
    needsReps: true,
    description: 'Projected best weight for the selected rep target.'
  },
  {
    value: 'actualRepMax',
    label: 'Actual rep max',
    unit: 'kg',
    needsReps: true,
    description: 'Heaviest actual set with at least the selected reps.'
  }
];

function seriesKeys(data, xKey) {
  return [...new Set(data.flatMap(row => Object.keys(row).filter(key => key !== xKey)))];
}

function formatAxisDate(value) {
  return String(value).slice(5);
}

function monthLabel(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

function moveMonth(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatValue(value, unit) {
  if (!Number.isFinite(Number(value))) return '-';
  const rounded = Math.round(Number(value) * 10) / 10;
  return unit ? `${rounded.toLocaleString()} ${unit}` : rounded.toLocaleString();
}

function parseLocalDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function periodStartDate(period) {
  const option = PERIOD_OPTIONS.find(item => item.value === period);
  if (!option?.years) return null;
  const start = new Date();
  start.setFullYear(start.getFullYear() - option.years);
  start.setHours(0, 0, 0, 0);
  return start;
}

function filterLogsByPeriod(logs, period) {
  const start = periodStartDate(period);
  if (!start) return logs;
  return logs.filter(log => {
    const date = parseLocalDate(log.date);
    return date && date >= start;
  });
}

function periodLabel(period) {
  return PERIOD_OPTIONS.find(item => item.value === period)?.label || 'Past Year';
}

function PeriodControls({ value, onChange, label = 'Period' }) {
  return (
    <div className={styles.periodGroup} aria-label={label}>
      {PERIOD_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? styles.activePeriod : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function buildTrendData(data) {
  if (data.length < 2) return data;

  const n = data.length;
  const sumX = data.reduce((sum, _row, index) => sum + index, 0);
  const sumY = data.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const sumXY = data.reduce((sum, row, index) => sum + index * Number(row.value || 0), 0);
  const sumXX = data.reduce((sum, _row, index) => sum + index * index, 0);
  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) return data;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return data.map((row, index) => ({
    ...row,
    trendValue: Math.max(0, Math.round((slope * index + intercept) * 10) / 10)
  }));
}

function normalizeHistoryRows(history = []) {
  return history
    .filter(row => row?.date && row?.exerciseName)
    .map((row, index) => ({
      ...row,
      id: `history-${row.id || index}`,
      sessionId: row.sessionId || `history-${row.date}`,
      sessionExerciseId: row.sessionExerciseId || `history-${row.date}-${row.exerciseName}`,
      exerciseName: row.exerciseName,
      muscleGroup: row.muscleGroup || 'Uncategorized',
      weight: Number(row.weight) || 0,
      reps: Number(row.reps) || 0,
      rir: row.rir || '',
      setNumber: row.setNumber,
      note: row.note || row.notes || row.comment || '',
      exerciseNote: row.note || row.notes || row.comment || '',
      source: 'history'
    }));
}

function buildDateDetails(logs, date) {
  const rows = logs.filter(log => log.date === date);
  const byExercise = {};

  rows.forEach(log => {
    if (!byExercise[log.exerciseName]) {
      byExercise[log.exerciseName] = {
        exerciseName: log.exerciseName,
        muscleGroup: log.muscleGroup || 'Uncategorized',
        sets: 0,
        volume: 0,
        best: null,
        notes: []
      };
    }
    const item = byExercise[log.exerciseName];
    const volume = (Number(log.weight) || 0) * (Number(log.reps) || 0);
    item.sets += 1;
    item.volume += volume;
    if (!item.best || Number(log.weight) > Number(item.best.weight || 0)) item.best = log;
    const note = log.note || log.exerciseNote;
    if (note && !item.notes.includes(note)) item.notes.push(note);
  });

  return Object.values(byExercise).sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

function ChartCard({ title, subtitle, data, xKey, lines }) {
  const keys = lines || seriesKeys(data, xKey);

  if (data.length === 0 || keys.length === 0) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.cardHeader}>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className={styles.noChart}>Not enough data yet.</div>
      </div>
    );
  }

  return (
    <div className={styles.chartCard}>
      <div className={styles.cardHeader}>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#252525" />
            <XAxis
              dataKey={xKey}
              minTickGap={18}
              tick={{ fill: '#707070', fontSize: 10 }}
              tickFormatter={formatAxisDate}
            />
            <YAxis tick={{ fill: '#707070', fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: 8 }}
              itemStyle={{ color: '#ffffff' }}
              labelStyle={{ color: '#b0b0b0' }}
            />
            {keys.length > 1 && (
              <Legend
                iconType="circle"
                wrapperStyle={{ color: '#b0b0b0', fontSize: 11, paddingTop: 8 }}
              />
            )}
            {keys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                connectNulls
                dot={{ fill: COLORS[index % COLORS.length], r: 2 }}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ExerciseTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className={styles.tooltip}>
      <strong>{label}</strong>
      <span>{metric.label}: {formatValue(row.value, metric.unit)}</span>
      <span>{row.sets} sets - {row.totalReps} reps - avg RIR {row.avgRIR}</span>
    </div>
  );
}

function ExerciseGraphCard({
  data,
  metric,
  selectedPoint,
  setSelectedPoint,
  showPoints,
  showTrend,
  yFromZero
}) {
  const chartData = showTrend ? buildTrendData(data) : data;

  if (chartData.length === 0) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.cardHeader}>
          <h2>{metric.label}</h2>
          <p>{metric.description}</p>
        </div>
        <div className={styles.noChart}>Not enough data for this graph type.</div>
      </div>
    );
  }

  const pointDot = props => {
    if (!showPoints) return null;
    const selected = selectedPoint?.date === props.payload.date;

    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={selected ? 5 : 3}
        fill={selected ? '#ffffff' : '#3b82f6'}
        stroke="#3b82f6"
        strokeWidth={selected ? 3 : 2}
        className={styles.pointDot}
        onClick={() => setSelectedPoint(props.payload)}
      />
    );
  };

  const activeDot = props => (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={5}
      fill="#ffffff"
      stroke="#3b82f6"
      strokeWidth={3}
      className={styles.pointDot}
      onClick={() => setSelectedPoint(props.payload)}
    />
  );

  return (
    <div className={styles.chartCard}>
      <div className={styles.cardHeader}>
        <h2>{metric.label}</h2>
        <p>{metric.description}</p>
      </div>
      <div className={styles.exerciseChartWrapper}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={EXERCISE_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#252525" />
            <XAxis
              dataKey="date"
              minTickGap={18}
              tick={{ fill: '#707070', fontSize: 10 }}
              tickFormatter={formatAxisDate}
            />
            <YAxis
              domain={yFromZero ? [0, 'auto'] : ['auto', 'auto']}
              tick={{ fill: '#707070', fontSize: 10 }}
            />
            <Tooltip content={<ExerciseTooltip metric={metric} />} />
            <Line
              type="monotone"
              dataKey="value"
              name={metric.label}
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={pointDot}
              activeDot={activeDot}
              connectNulls
            />
            {showTrend && chartData.length > 1 && (
              <Line
                type="linear"
                dataKey="trendValue"
                name="Trend"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PointDetails({ point, metric }) {
  if (!point) {
    return (
      <div className={styles.detailPanel}>
        <h3>Selected point</h3>
        <p className={styles.muted}>Select a graph point to inspect the workout behind it.</p>
      </div>
    );
  }

  const bestSet = point.bestSet;

  return (
    <div className={styles.detailPanel}>
      <div>
        <span className={styles.detailDate}>{point.date}</span>
        <h3>{formatValue(point.value, metric.unit)}</h3>
      </div>
      <div className={styles.detailGrid}>
        <span>Volume <strong>{formatValue(point.volume, 'kg')}</strong></span>
        <span>Total reps <strong>{point.totalReps}</strong></span>
        <span>Max weight <strong>{formatValue(point.maxWeight, 'kg')}</strong></span>
        <span>Max reps <strong>{point.maxReps}</strong></span>
        <span>Estimated 1RM <strong>{formatValue(point.estimated1RM, 'kg')}</strong></span>
        <span>Avg RIR <strong>{point.avgRIR}</strong></span>
      </div>
      {bestSet && (
        <div className={styles.bestSet}>
          <span>Best contributing set</span>
          <strong>
            Set {bestSet.setNumber || '?'} - {bestSet.weight} kg x {bestSet.reps} @ RIR {bestSet.rir ?? '?'}
          </strong>
          {bestSet.compromisedForm && <em>Form was flagged on this set.</em>}
          {bestSet.note && <p>{bestSet.note}</p>}
        </div>
      )}
    </div>
  );
}

function CalendarCard({ calendarDays, calendarMonth, setCalendarMonth, streak, selectedDate, setSelectedDate, dateDetails }) {
  return (
    <section className={styles.calendarCard}>
      <div className={styles.calendarHeader}>
        <div>
          <span className={styles.eyebrow}>Sessions</span>
          <h2>{monthLabel(calendarMonth)}</h2>
        </div>
        <div className={styles.monthControls}>
          <button onClick={() => setCalendarMonth(prev => moveMonth(prev, -1))}>Prev</button>
          <button onClick={() => setCalendarMonth(new Date())}>Today</button>
          <button onClick={() => setCalendarMonth(prev => moveMonth(prev, 1))}>Next</button>
        </div>
      </div>
      <div className={styles.streakStrip}>
        <div>
          <span className={styles.streakValue}>{streak.current}</span>
          <span className={styles.streakLabel}>week streak</span>
        </div>
        <p>
          {streak.thisWeekSessions} / {streak.target || '-'} sessions this week
          {streak.target ? ' against the active plan target.' : '. Set an active block to calculate a target.'}
        </p>
      </div>
      <div className={styles.weekdays}>
        {WEEKDAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
      </div>
      <div className={styles.calendarGrid}>
        {calendarDays.map(day => (
          <button
            key={day.key}
            type="button"
            className={`${styles.calendarDay} ${day.inMonth ? '' : styles.blankDay} ${day.hasSession ? styles.sessionDay : ''} ${selectedDate === day.date ? styles.selectedDay : ''}`}
            onClick={() => day.inMonth && setSelectedDate(day.date)}
            disabled={!day.inMonth}
            title={day.hasSession ? `${day.sessionCount} session${day.sessionCount === 1 ? '' : 's'}` : ''}
          >
            {day.inMonth && (
              <>
                <span>{day.day}</span>
                {day.hasSession && <strong>{day.sessionCount}</strong>}
              </>
            )}
          </button>
        ))}
      </div>
      {selectedDate && (
        <div className={styles.dateDetails}>
          <div className={styles.dateDetailsHeader}>
            <span>{selectedDate}</span>
            <strong>{dateDetails.length} exercise{dateDetails.length === 1 ? '' : 's'}</strong>
          </div>
          {dateDetails.length === 0 ? (
            <p>No performed exercises on this day.</p>
          ) : dateDetails.map(item => (
            <div key={item.exerciseName} className={styles.dateExercise}>
              <div>
                <span>{item.muscleGroup}</span>
                <strong>{item.exerciseName}</strong>
              </div>
              <em>{item.sets} sets / {Math.round(item.volume).toLocaleString()} kg</em>
              {item.best && <small>Best: {item.best.weight} kg x {item.best.reps} @ RIR {item.best.rir || '?'}</small>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AnalyticsScreen() {
  const { activeBlock, appSettings } = useApp();
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('exercise');
  const [selectedExercise, setSelectedExercise] = useState('');
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [exercisePeriod, setExercisePeriod] = useState('1y');
  const [graphMetric, setGraphMetric] = useState('estimated1RM');
  const [selectedReps, setSelectedReps] = useState(5);
  const [showPoints, setShowPoints] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [yFromZero, setYFromZero] = useState(false);
  const [useRIR, setUseRIR] = useState(true);
  const [workloadPeriod, setWorkloadPeriod] = useState('1y');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState(ALL_MUSCLE_GROUPS);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    async function load() {
      const [allLogs, allHistory] = await Promise.all([getAllLogs(), getAllHistory()]);
      setLogs([...allLogs.map(log => ({ ...log, source: log.source || 'app' })), ...normalizeHistoryRows(allHistory)]);
    }

    load();
  }, []);

  const uniqueExercises = useMemo(
    () => [...new Set(logs.map(log => log.exerciseName).filter(Boolean))].sort(),
    [logs]
  );

  const uniqueMuscleGroups = useMemo(
    () => [...new Set(logs.map(log => log.muscleGroup || 'Uncategorized').filter(Boolean))].sort(),
    [logs]
  );

  useEffect(() => {
    if (!selectedExercise && uniqueExercises.length > 0) {
      setSelectedExercise(uniqueExercises[0]);
      setExerciseSearch(uniqueExercises[0]);
    }
  }, [selectedExercise, uniqueExercises]);

  useEffect(() => {
    if (selectedExercise && !exerciseSearch) {
      setExerciseSearch(selectedExercise);
    }
  }, [exerciseSearch, selectedExercise]);

  useEffect(() => {
    if (selectedMuscleGroup !== ALL_MUSCLE_GROUPS && !uniqueMuscleGroups.includes(selectedMuscleGroup)) {
      setSelectedMuscleGroup(ALL_MUSCLE_GROUPS);
    }
  }, [selectedMuscleGroup, uniqueMuscleGroups]);

  const selectedMetric = GRAPH_METRICS.find(metric => metric.value === graphMetric) || GRAPH_METRICS[0];

  const analytics = useMemo(() => {
    const plannedSessionsPerWeek = inferPlannedSessionsPerWeek(appSettings, activeBlock);
    const exerciseLogs = filterLogsByPeriod(logs, exercisePeriod);
    const workloadLogs = filterLogsByPeriod(logs, workloadPeriod)
      .filter(log => selectedMuscleGroup === ALL_MUSCLE_GROUPS || (log.muscleGroup || 'Uncategorized') === selectedMuscleGroup);

    return {
      exerciseGraph: buildExerciseGraphData(exerciseLogs, selectedExercise, {
        metric: graphMetric,
        selectedReps,
        useRIR
      }),
      weeklyMuscleTonnage: buildWeeklyMuscleGroupTonnage(workloadLogs),
      weeklySetDensity: buildWeeklySetDensity(workloadLogs),
      weeklyTonnage: buildWeeklyTonnage(workloadLogs),
      weeklyAverageRIR: buildWeeklyAverageRIR(workloadLogs),
      calendarDays: buildMonthlySessionCalendar(logs, calendarMonth),
      streak: buildWeeklySessionStreak(logs, plannedSessionsPerWeek)
    };
  }, [activeBlock, appSettings, calendarMonth, exercisePeriod, graphMetric, logs, selectedExercise, selectedMuscleGroup, selectedReps, useRIR, workloadPeriod]);
  const dateDetails = useMemo(() => buildDateDetails(logs, selectedDate), [logs, selectedDate]);

  useEffect(() => {
    setSelectedPoint(analytics.exerciseGraph[analytics.exerciseGraph.length - 1] || null);
  }, [analytics.exerciseGraph]);

  return (
    <div className={styles.viewport}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Training intelligence</span>
        <h1>Analytics</h1>
      </div>

      {uniqueExercises.length === 0 ? (
        <div className={styles.empty}>
          <p>No data yet. Complete some workouts to see analytics.</p>
        </div>
      ) : (
        <>
          <nav className={styles.tabs} aria-label="Analytics sections">
            {[
              ['exercise', 'Exercise'],
              ['calendar', 'Calendar'],
              ['weekly', 'Workload']
            ].map(([id, label]) => (
              <button
                key={id}
                className={activeTab === id ? styles.activeTab : ''}
                onClick={() => setActiveTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {activeTab === 'exercise' && (
            <>
              <section className={styles.selectorCard}>
                <div className={styles.controlGrid}>
                  <label>
                    <span>Selected exercise</span>
                    <input
                      className={styles.select}
                      type="search"
                      list="analytics-exercise-options"
                      value={exerciseSearch}
                      onChange={event => {
                        const nextValue = event.target.value;
                        setExerciseSearch(nextValue);
                        if (uniqueExercises.includes(nextValue)) {
                          setSelectedExercise(nextValue);
                        }
                      }}
                      onBlur={() => {
                        if (uniqueExercises.includes(exerciseSearch)) {
                          setSelectedExercise(exerciseSearch);
                        } else {
                          setExerciseSearch(selectedExercise);
                        }
                      }}
                      placeholder="Search exercises"
                    />
                    <datalist id="analytics-exercise-options">
                      {uniqueExercises.map(name => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    <span>Graph type</span>
                    <select
                      value={graphMetric}
                      onChange={event => setGraphMetric(event.target.value)}
                      className={styles.select}
                    >
                      {GRAPH_METRICS.map(metric => (
                        <option key={metric.value} value={metric.value}>{metric.label}</option>
                      ))}
                    </select>
                  </label>
                  {selectedMetric.needsReps && (
                    <label>
                      <span>Selected reps</span>
                      <input
                        className={styles.numberInput}
                        type="number"
                        min="1"
                        value={selectedReps}
                        onChange={event => setSelectedReps(Math.max(1, Number(event.target.value) || 1))}
                      />
                    </label>
                  )}
                </div>
                <div className={styles.toggleRow}>
                  <label><input type="checkbox" checked={showPoints} onChange={event => setShowPoints(event.target.checked)} /> Graph points</label>
                  <label><input type="checkbox" checked={showTrend} onChange={event => setShowTrend(event.target.checked)} /> Trend line</label>
                  <label><input type="checkbox" checked={yFromZero} onChange={event => setYFromZero(event.target.checked)} /> Y-axis from 0</label>
                  <label><input type="checkbox" checked={useRIR} onChange={event => setUseRIR(event.target.checked)} /> Use RIR in estimates</label>
                </div>
                <PeriodControls value={exercisePeriod} onChange={setExercisePeriod} label="Exercise trend period" />
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2>Exercise trend</h2>
                  <p>{selectedMetric.description} Daily output for {selectedExercise} - {periodLabel(exercisePeriod)}.</p>
                </div>
                <div className={styles.exerciseGrid}>
                  <ExerciseGraphCard
                    data={analytics.exerciseGraph}
                    metric={selectedMetric}
                    selectedPoint={selectedPoint}
                    setSelectedPoint={setSelectedPoint}
                    showPoints={showPoints}
                    showTrend={showTrend}
                    yFromZero={yFromZero}
                  />
                  <PointDetails point={selectedPoint} metric={selectedMetric} />
                </div>
              </section>
            </>
          )}

          {activeTab === 'calendar' && (
            <CalendarCard
              calendarDays={analytics.calendarDays}
              calendarMonth={calendarMonth}
              setCalendarMonth={setCalendarMonth}
              streak={analytics.streak}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              dateDetails={dateDetails}
            />
          )}

          {activeTab === 'weekly' && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>Workload</h2>
                <p>Aggregated from logged sets - {periodLabel(workloadPeriod)}.</p>
              </div>
              <div className={styles.selectorCard}>
                <div className={styles.workloadControls}>
                  <label>
                    <span>Muscle group</span>
                    <select
                      value={selectedMuscleGroup}
                      onChange={event => setSelectedMuscleGroup(event.target.value)}
                      className={styles.select}
                    >
                      <option value={ALL_MUSCLE_GROUPS}>All muscle groups</option>
                      {uniqueMuscleGroups.map(group => (
                        <option key={group} value={group}>{group}</option>
                      ))}
                    </select>
                  </label>
                  <PeriodControls value={workloadPeriod} onChange={setWorkloadPeriod} label="Workload period" />
                </div>
              </div>
              <div className={styles.grid}>
                <ChartCard title="Muscle-group tonnage" subtitle="Weekly tonnage by muscle group" data={analytics.weeklyMuscleTonnage} xKey="week" />
                <ChartCard title="Set density" subtitle="Sets per week by muscle group" data={analytics.weeklySetDensity} xKey="week" />
                <ChartCard title="Weekly tonnage" subtitle="Total load moved each week" data={analytics.weeklyTonnage} xKey="week" lines={['tonnage']} />
                <ChartCard title="Average RIR" subtitle="Average logged proximity to failure per week" data={analytics.weeklyAverageRIR} xKey="week" lines={['avgRIR']} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
