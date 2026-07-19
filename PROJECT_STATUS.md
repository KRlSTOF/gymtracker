# GymTracker project status

This is a lightweight product and engineering compass for future development sessions. It records the current state and decision priorities without pretending that unplanned ideas are committed scope.

## Current state

The main product flows are implemented:

- planned and extra workout sessions;
- per-set logging, editing, notes, RIR, compromised-form handling, and rest timing;
- resumable active workouts;
- training-block planning and CSV import/export;
- exercise library and defaults;
- workout history, summaries, and analytics;
- FitNotes history import;
- full local JSON backup and restore;
- PWA output and signed Android APK delivery through GitHub Actions.

The application is personal and offline-first. There is no current requirement for user accounts, multi-device synchronization, social features, or a hosted service.

## Current priorities

1. **Data reliability:** prevent duplicate or lost sets, make interrupted sessions recoverable, keep upgrades and backups compatible, and surface failures clearly.
2. **APK update safety:** preserve package identity, signing continuity, increasing version codes, and local data across installs.
3. **Workout-speed UX:** minimize taps and typing during a session, make current/next targets obvious, and behave well with one-handed mobile use.
4. **Frontend polish:** improve clarity, consistency, responsive layout, accessibility, and feedback without destabilizing completed flows.
5. **Maintainability:** gradually extract pure logic and focused components from large screens and add automated coverage around risky data behavior.

## Decision rules

When priorities compete:

- data preservation beats convenience;
- correct recovery beats optimistic UI;
- a small compatible migration beats resetting storage;
- a clear mobile flow beats adding more information to one screen;
- existing user data beats a cleaner new schema;
- focused incremental refactoring beats a rewrite;
- verified behavior beats speculative abstraction.

## Reliability backlog candidates

These are areas to assess and prioritize, not instructions to implement all at once:

- formalize stored record shapes and backup compatibility policy;
- add automated migration, backup/restore, CSV, and duplicate-set tests;
- centralize local date and numeric normalization helpers;
- make persistence errors visible and recoverable in the UI;
- audit every multi-step write for atomicity and retry behavior;
- define how the two active-session copies are reconciled after partial failure;
- test with large workout histories and long-running training blocks;
- add a safe diagnostic/export path for corrupted or unexpected records.

## Frontend backlog candidates

- audit workout flows on a narrow Android viewport with the keyboard open;
- improve loading, empty, success, and error states;
- check dialogs, focus order, labels, contrast, and touch-target size;
- extract repeated controls and formatting without creating a generic component layer prematurely;
- reduce avoidable re-renders in analytics and large planner datasets after measuring them;
- keep important workout actions reachable and resistant to accidental taps.

## Before introducing a remote backend

A hosted backend is a separate product decision, not an automatic reliability improvement. Before adding one, decide:

- whether the goal is backup, cross-device sync, analytics, or all three;
- what happens offline and how conflicts are resolved;
- which side owns canonical IDs and timestamps;
- authentication and account recovery requirements;
- privacy, encryption, retention, and deletion rules for health-adjacent data;
- how existing local-only users migrate and how they can export/leave;
- ongoing hosting, monitoring, and maintenance expectations.

Until those decisions exist, strengthen IndexedDB and full backups as the canonical system.

## Definition of done for future features

A feature is ready when:

- its normal, empty, interrupted, and error paths are considered;
- old stored data and backups remain usable or receive a documented migration;
- it works at mobile width and with touch input;
- the production build succeeds in Codespaces;
- APK-specific behavior is tested on Android when applicable;
- no secrets, generated artifacts, or personal exports enter Git;
- architecture and workflow documents are updated if assumptions changed.
