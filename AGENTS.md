# GymTracker agent guide

This file is the working contract for Codex and other coding agents in this repository. Read it together with [ARCHITECTURE.md](ARCHITECTURE.md), [DEVELOPMENT.md](DEVELOPMENT.md), and [PROJECT_STATUS.md](PROJECT_STATUS.md) before making broad changes.

## Product intent

GymTracker is a personal, mobile-first gym progress logger. The core workout, planning, analytics, import/export, and settings flows already exist. Current work should favor reliability, data safety, small UX improvements, and maintainability over large rewrites.

The production target is an Android APK built by GitHub Actions from `main`. The browser/PWA build remains useful for development and Codespaces testing.

## Repository facts

- Frontend: React 18, React Router, CSS Modules, and Recharts.
- Web build: Vite 5 with `vite-plugin-pwa`.
- Android shell: Capacitor 8 in `android/`.
- Persistence: IndexedDB through `idb` in `src/data/db.js`.
- Active workout recovery: mirrored in IndexedDB settings and `localStorage` by `AppContext`.
- Routing: `HashRouter`, required for the packaged app and relative web assets.
- There is currently no remote API, server, account system, or cloud sync.
- There is currently no automated JavaScript test suite or lint script.

## Non-negotiable constraints

1. Protect user workout data. Never clear, rename, or reinterpret IndexedDB stores without an explicit, versioned migration and a compatible backup/import plan.
2. Preserve update-safe Android identity. Do not change `com.gymtracker.app`, signing configuration, or version-code behavior unless the task explicitly requires it and the consequences are documented.
3. Keep `base: './'`, `HashRouter`, and Capacitor's `webDir: 'dist'` unless the entire web-to-APK path is deliberately migrated and verified.
4. Do not commit signing keys, exported user data, generated APKs, `node_modules/`, `dist/`, or Android build output.
5. Treat `android/` as a generated/native integration layer. Prefer changes in web source or Capacitor configuration; explain and verify direct native edits.
6. Vite is not runnable in the owner's local environment. Do not claim browser or APK behavior was verified locally when only static inspection was possible.
7. Do not overwrite unrelated work. Inspect `git status` before and after changes and keep the patch scoped.

## How to work in this codebase

Before editing:

1. Read the relevant screen, its CSS Module, `AppContext`, and affected data helpers.
2. Trace persisted fields through creation, update, export, import, analytics, and rendering paths.
3. Identify whether the change affects an in-progress session, old logs, imported FitNotes history, or existing backups.

While editing:

- Keep database access in `src/data/db.js`; screens should use its exported operations instead of opening IndexedDB directly.
- Keep shared application state and persistence coordination in `src/context/AppContext.jsx`.
- Put pure calculations and aggregation in `src/data/calculations.js`.
- Keep CSV parsing/serialization and normalization in `src/data/csvImport.js`.
- Use immutable React state updates. Do not mutate blocks, days, exercises, sessions, or logs in place.
- Use stable IDs for persisted/session entities. A workout set is idempotently identified by `sessionId`, `sessionExerciseId`, and numeric `setNumber`.
- Preserve legacy fallbacks when changing a stored shape. Existing data may lack newer fields.
- Use local calendar dates (`YYYY-MM-DD`) for workout-day grouping. Avoid deriving the workout date with UTC conversion.
- Keep touch targets, safe areas, the Android back button, the on-screen keyboard, portrait layout, and interrupted workouts in mind.
- Match the existing visual language and colocate screen styles in `*.module.css`; global tokens and app-wide rules belong in `src/styles/global.css`.
- Avoid adding dependencies for behavior that is straightforward to implement with the current stack.

## Reliability checklist for persistence changes

- Does an upgrade increment `DB_VERSION` and gate migration work using `oldVersion`?
- Can an existing database upgrade without deleting records?
- Are multi-store or multi-record writes atomic where partial completion would corrupt state?
- Does repeated user input or retrying an operation avoid duplicate sets?
- Does export include the new durable data?
- Does import validate and restore it, while remaining compatible with older backups when intended?
- Can an active workout survive navigation, refresh, app backgrounding, and process restart?
- Are numeric IDs and string IDs compared safely where imported data may differ in type?
- Are errors surfaced to the user or handled intentionally rather than silently losing data?

## Verification expectations

Use the strongest checks available and report exactly what ran.

- Static review is always required.
- If Node/Vite is available in Codespaces: run `npm ci` and `npm run build`.
- For interactive behavior: run `npm run dev -- --host 0.0.0.0`, open the forwarded port, and complete the relevant manual scenario in [DEVELOPMENT.md](DEVELOPMENT.md).
- For APK-sensitive changes: run `npm run apk:prepare` in Codespaces when practical, then rely on the GitHub Actions signed release build and test the artifact on Android.
- Do not use `npm install` merely to test a locked dependency tree; CI uses `npm ci`.
- If verification cannot run locally, say so and provide a precise Codespaces/device test checklist.

## Completion standard

A change is complete when the requested behavior is implemented, data compatibility has been considered, available checks pass, the Git diff is scoped, and any verification that must happen in Codespaces or on Android is clearly handed off. Update these project documents when architecture, persistence, build workflow, or priorities materially change.
