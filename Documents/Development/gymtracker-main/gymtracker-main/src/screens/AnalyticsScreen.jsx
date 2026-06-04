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
import { getAllLogs } from '../data/db.js';
import {
  buildDailyExerciseMetrics,
  buildDailyOneRepMaxByRIR,
  buildDailyVolumeByRIR,
  buildWeeklyAverageRIR,
  buildWeeklyMuscleGroupTonnage,
  buildWeeklySetDensity,
  buildWeeklyTonnage
} from '../data/calculations.js';
import styles from './AnalyticsScreen.module.css';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'];
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -16 };

function seriesKeys(data, xKey) {
  return [...new Set(data.flatMap(row => Object.keys(row).filter(key => key !== xKey)))];
}

function formatAxisDate(value) {
  return String(value).slice(5);
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

export default function AnalyticsScreen() {
  const [logs, setLogs] = useState([]);
  const [selectedExercise, setSelectedExercise] = useState('');

  useEffect(() => {
    async function load() {
      const allLogs = await getAllLogs();
      setLogs(allLogs);
    }

    load();
  }, []);

  const uniqueExercises = useMemo(
    () => [...new Set(logs.map(log => log.exerciseName).filter(Boolean))].sort(),
    [logs]
  );

  useEffect(() => {
    if (!selectedExercise && uniqueExercises.length > 0) {
      setSelectedExercise(uniqueExercises[0]);
    }
  }, [selectedExercise, uniqueExercises]);

  const analytics = useMemo(() => ({
    dailyMetrics: buildDailyExerciseMetrics(logs, selectedExercise),
    dailyVolumeByRIR: buildDailyVolumeByRIR(logs, selectedExercise),
    dailyOneRepMaxByRIR: buildDailyOneRepMaxByRIR(logs, selectedExercise),
    weeklyMuscleTonnage: buildWeeklyMuscleGroupTonnage(logs),
    weeklySetDensity: buildWeeklySetDensity(logs),
    weeklyTonnage: buildWeeklyTonnage(logs),
    weeklyAverageRIR: buildWeeklyAverageRIR(logs)
  }), [logs, selectedExercise]);

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
          <section className={styles.selectorCard}>
            <label htmlFor="exercise-select">Selected exercise</label>
            <select
              id="exercise-select"
              value={selectedExercise}
              onChange={event => setSelectedExercise(event.target.value)}
              className={styles.select}
            >
              {uniqueExercises.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Exercise trend</h2>
              <p>Daily output for {selectedExercise}</p>
            </div>
            <div className={styles.grid}>
              <ChartCard
                title="Daily selected-exercise metrics"
                subtitle="Best estimated 1RM, total tonnage, sets, and average RIR"
                data={analytics.dailyMetrics}
                xKey="date"
                lines={['e1rm', 'volume', 'sets', 'avgRIR']}
              />
              <ChartCard
                title="Volume by RIR"
                subtitle="Daily tonnage split by logged RIR"
                data={analytics.dailyVolumeByRIR}
                xKey="date"
              />
              <ChartCard
                title="1RM by RIR"
                subtitle="Best daily estimated 1RM for each RIR bucket"
                data={analytics.dailyOneRepMaxByRIR}
                xKey="date"
              />
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Weekly workload</h2>
              <p>Aggregated from every logged set</p>
            </div>
            <div className={styles.grid}>
              <ChartCard
                title="Muscle-group tonnage"
                subtitle="Weekly tonnage by muscle group"
                data={analytics.weeklyMuscleTonnage}
                xKey="week"
              />
              <ChartCard
                title="Set density"
                subtitle="Sets per week by muscle group"
                data={analytics.weeklySetDensity}
                xKey="week"
              />
              <ChartCard
                title="Weekly tonnage"
                subtitle="Total load moved each week"
                data={analytics.weeklyTonnage}
                xKey="week"
                lines={['tonnage']}
              />
              <ChartCard
                title="Average RIR"
                subtitle="Average logged proximity to failure per week"
                data={analytics.weeklyAverageRIR}
                xKey="week"
                lines={['avgRIR']}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
