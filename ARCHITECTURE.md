# GymTracker architecture

## System overview

GymTracker is an offline-first single-user application. The same React build runs as a PWA in a browser and inside a Capacitor Android WebView.

```text
React screens and CSS Modules
          |
          v
AppContext (shared state and active-session recovery)
          |
          v
Data modules (IndexedDB access, CSV I/O, calculations)
          |
          v
IndexedDB: exercises | blocks | logs | history | settings

Vite build -> dist/ -> Capacitor sync -> Android project -> signed APK
```

There is no network backend in the current architecture. In this project, “backend reliability” primarily means IndexedDB schema evolution, transactional writes, backup/restore integrity, active-session recovery, and consistent derived analytics. A future remote backend should be introduced behind a clear repository/service boundary rather than mixed into screens.

## Runtime layers

### Application shell

- `src/main.jsx` mounts React.
- `src/App.jsx` owns routing and native-shell behavior.
- `HashRouter` avoids server rewrite requirements and works with the packaged APK.
- `CapacitorShell` configures native status-bar behavior and maps Android back-button events to dialogs, editable controls, and route history.
- `src/components/Layout.jsx` provides the root navigation for Workout, Planner, Analytics, and Settings.

### Screens

| Route | Screen | Responsibility |
| --- | --- | --- |
| `/` | `WorkoutScreen.jsx` | Start/resume planned or extra sessions, reorder exercises, and review workout history. |
| `/planner` | `PlannerScreen.jsx` | Create, edit, duplicate, import, activate, and advance training blocks. |
| `/analytics` | `AnalyticsScreen.jsx` | Derive charts and progress views from logs and exercise metadata. |
| `/settings` | `SettingsScreen.jsx` | App defaults, exercise library, FitNotes import, backups, CSV export, and manual log entry. |
| `/exercise/:dayId/:exerciseIndex` | `ExerciseSession.jsx` | Log and edit sets, show references, preserve drafts, and move through an active session. |
| `/timer` | `TimerScreen.jsx` | Run rest timing and navigate to the next set or exercise. |
| `/summary/:dayId` | `SessionSummary.jsx` | Summarize the workout, calculate records, and advance a planned block once. |

Some screens are large and currently combine orchestration with presentation. Prefer extracting tested pure helpers or small focused components as they are touched; avoid a high-risk all-at-once rewrite.

### Shared state

`src/context/AppContext.jsx` loads durable data and exposes the cross-screen operations used by the UI:

- exercise library and training blocks;
- the active block and next planned day;
- app settings;
- current workout session and recovery;
- refresh operations after database writes;
- idempotent planned-day completion.

The current session is saved to both the `settings` store under `currentSession` and `localStorage` under `gym-tracker-active-session`. `localStorage` provides fast synchronous startup recovery; IndexedDB is the durable fallback. Changes to session shape must account for both copies and old snapshots.

## Persistence model

The database name is `gym-tracker`; its current schema version is `2`.

| Store | Key/indexes | Purpose |
| --- | --- | --- |
| `exercises` | auto-increment `id`; `name`, `muscleGroup` | Canonical exercise library and per-exercise defaults. |
| `blocks` | auto-increment `id` | Nested training plans containing days, exercises, and set targets. |
| `logs` | auto-increment `id`; exercise/date/session indexes | One durable record per completed set. |
| `history` | auto-increment `id`; exercise name/date indexes | Historical FitNotes data kept separately from native logs. |
| `settings` | string `key` | Active block, active session, defaults, and other application settings. |

Important identity relationships:

- `exercise.id` is referenced as `libraryId` or `exerciseId` in plans, session snapshots, and logs.
- A planned workout points to `blockId` and a zero-based `dayId`/day index.
- Every active workout receives a `sessionId`.
- Every exercise occurrence in that session receives a `sessionExerciseId`; this matters when an exercise appears twice.
- A set is uniquely retried by the tuple `(sessionId, sessionExerciseId, setNumber)`. `addLogOnce` checks that tuple before inserting.

Training blocks and active sessions are intentionally snapshots. Editing the exercise library must not silently rewrite historical set logs. Session code may reconcile mutable defaults such as rest time and weight step, but historical workout facts should remain stable.

### Schema migration rules

When changing durable data:

1. Increment `DB_VERSION`.
2. Add an `oldVersion`-guarded upgrade in `src/data/db.js`.
3. Make the migration safe for empty, current, and legacy databases.
4. Keep reads tolerant of older optional fields where possible.
5. Update backup `schemaVersion`, validation, export, and import together.
6. Test an upgrade using populated data, not only a fresh database.
7. Export a backup before testing destructive or ambiguous migrations on the real phone.

## Data movement

### Set logging

```text
Plan/library snapshot -> currentSession -> ExerciseSession draft
    -> addLogOnce -> logs store -> session recovery state
    -> rest timer / next exercise -> session summary -> block advancement
```

The ordering is data-sensitive. A set must be durably written before UI state treats it as completed. Retries must resolve to the existing log rather than creating duplicates.

### Import and export

- Full JSON backup covers all five stores and is the disaster-recovery format.
- CSV exports support workout data and completed blocks but are not a complete application backup.
- FitNotes CSV imports into `history` and supports reference/analytics use.
- Block CSV import creates block content and may add missing exercises to the library.

Full restore clears and repopulates all stores inside one read-write transaction after validation. Any future stored collection must be included deliberately in both export and restore.

## Build and delivery

`vite.config.js` creates relative assets and a PWA manifest. `capacitor.config.ts` points Capacitor at `dist/`. GitHub Actions then:

1. checks out `main`;
2. installs Node 22 dependencies using `npm ci`;
3. builds the React app;
4. syncs the web output into Android;
5. restores the permanent signing key from GitHub secrets;
6. builds a signed release APK with Java 21;
7. uploads `gymtracker-apk` as a workflow artifact.

`android/app/build.gradle` uses `GITHUB_RUN_NUMBER` as `versionCode` and builds `versionName` as `1.0.<run number>`. Package ID plus permanent signing key plus increasing version code allow a new artifact to update the installed app without removing local data. See [APK_UPDATES.md](APK_UPDATES.md).

## Architectural direction

Near-term reliability improvements should strengthen the current offline-first system before adding infrastructure. If cloud sync or a remote backend is added later, define conflict resolution, authentication, offline queues, ownership of canonical IDs, encryption/privacy, and migration from local-only data before implementation. IndexedDB should remain a usable offline cache, not become an incidental second source of truth.
