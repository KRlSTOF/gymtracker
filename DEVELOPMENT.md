# GymTracker development workflow

## Environment constraints

The project owner cannot run Vite in the current local environment. Local Codex work can still inspect and edit source, review diffs, and run any non-Vite tools that happen to be available, but browser behavior must be verified in GitHub Codespaces. Final Android behavior must be verified with the APK on a device.

Never describe a static review as a successful runtime test.

## Codespaces setup and browser testing

Open the repository in a GitHub Codespace, then run:

```bash
npm ci
npm run build
npm run dev -- --host 0.0.0.0
```

Open the forwarded Vite port. Browser data is scoped to that Codespace URL, so it is test data rather than the data stored by the installed Android app.

For a production-build smoke test:

```bash
npm run build
npm run preview -- --host 0.0.0.0
```

That normal build retains PWA registration for browser testing. Do not copy it directly into Android. `npm run apk:prepare` uses Vite's `capacitor` mode, disables PWA registration in the packaged WebView, emits the legacy service-worker cleanup asset, and then syncs `dist/` into the Android project.

Because no JavaScript test or lint commands are configured yet, `npm run build` is the minimum automated check: it catches module resolution, syntax, JSX, and bundling failures, but it does not prove user flows or persistence behavior.

## Routine change workflow

1. Pull the latest branch and inspect `git status`.
2. Export a full JSON backup from the installed app before data-layer or migration work.
3. Make the smallest cohesive source change.
4. Review the complete diff for generated files, secrets, and accidental data-shape changes.
5. Push the branch and open it in Codespaces.
6. Run the build and the relevant manual scenarios below.
7. Merge/push to `main` only when ready to produce a signed APK build.
8. Download the `gymtracker-apk` artifact from the `Build Android APK` Actions run and test it as an update on Android.

Do not commit `dist/` or Android build output. The workflow rebuilds and syncs them.

## Manual smoke tests

Use a disposable browser dataset where possible. For changes that touch persistence, also test with a restored copy of representative data.

### Core workout

- Start the next planned workout and confirm its block/day/exercise snapshot.
- Log several sets, including rapid/double input, and verify there are no duplicates.
- Edit a completed set and confirm history and analytics reflect the edit.
- Navigate away, refresh/reload, and resume the same exercise and draft.
- Complete an exercise, use/skip the rest timer, and move to the correct next target.
- Reorder, add, switch, and remove session exercises when relevant.
- Finish a session and confirm the summary uses only that session's logs.
- Confirm the planned block advances exactly once; extra sessions must not advance it.

### Planner

- Create and edit a block with multiple days and per-set targets.
- Duplicate a block/week and confirm nested data is independent.
- Activate a block and verify the workout screen shows the expected next day.
- Import a block CSV and verify new library exercises and targets.
- Ensure edits do not corrupt a workout already in progress.

### Data safety

- Export a full JSON backup and inspect that exercises, blocks, logs, history, and settings exist.
- Restore the backup into disposable storage and compare record counts and active settings.
- Reject malformed backups without clearing current data.
- Import representative FitNotes CSV data and check date, exercise, weight, reps, RIR, and note handling.
- Verify dates close to midnight remain assigned to the intended local calendar day.

### Analytics and UI

- Check empty, single-entry, and multi-week datasets.
- Check compromised-form/RIR handling and exercise-name/library-ID fallbacks.
- Test narrow mobile width, long exercise names, keyboard-open layouts, scrolling, dialogs, and touch targets.
- Test Android system back from a form field, dialog, nested route, and root route.

## Building and testing the APK

A push to `main` or a manual workflow dispatch runs `.github/workflows/build-android.yml`. The job requires these repository secrets:

- `GYMTRACKER_KEYSTORE_BASE64`
- `GYMTRACKER_KEYSTORE_PASSWORD`
- `GYMTRACKER_KEY_ALIAS`
- `GYMTRACKER_KEY_PASSWORD`

One-time signing setup is documented in [APK_UPDATES.md](APK_UPDATES.md). Never regenerate or replace the key casually: an APK signed with a different key cannot update the installed app.

After a successful workflow:

1. Download the `gymtracker-apk` artifact.
2. Install it over the current application; do not uninstall first during a normal update test.
3. Confirm the existing workout history, plans, settings, and active-session behavior remain intact.
4. Repeat the changed flow on the phone, including background/resume and Android back behavior.

For shell-sensitive behavior, additionally verify that the status and navigation bars do not cover controls, Back dismisses the keyboard and dialogs before navigating, Back on a root tab minimizes the app, rotation remains locked to portrait, and a running rest timer reconciles immediately after backgrounding or locking the phone past its expiry time.

If Android refuses the update, first compare package ID, signing key, and version code. Do not solve an update failure by uninstalling until a current full backup has been exported, because uninstalling removes local app data.

## Change-specific handoff template

When a change cannot be exercised locally, include this in the handoff:

```text
Implemented:
- <behavior and files>

Checked locally:
- Static inspection / diff review / any command that actually ran

Run in Codespaces:
- npm ci
- npm run build
- <specific browser scenario>

Run on Android artifact:
- <specific device scenario>
- Confirm existing local data remains present
```

## Recommended future test foundation

When automated testing is added, start with high-value pure and persistence behavior rather than snapshots:

- calculation edge cases and date grouping;
- CSV normalization and round trips;
- IndexedDB migration and backup/restore tests using a browser-compatible fake IndexedDB;
- idempotent `addLogOnce` retries;
- active-session reducer/helper tests after session logic is extracted from screens;
- a small browser end-to-end suite for interrupted workout recovery and planned-day completion.
