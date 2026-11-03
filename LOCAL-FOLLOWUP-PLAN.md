# Follow-up: preserve the paper workflow and repair launcher usability

Authorized by the user after activating local release 20261104-043732.

1. Diagnose the actual installed uTools launch entry and cache shape read-only. Correct application discovery/filtering and add the real regression shape. Keep unrelated sources opt-in. The user clarified that adding only uTools is insufficient: supplement shortcut discovery using known installation registrations and bounded installation directories, with manual addition retained for arbitrary unregistered portable locations.
2. Add a dedicated drag region, native edge resize and persisted width/height to the super panel. Keep icon reordering independent. Summoning still anchors to the mouse and clamps to the current display's work area in Electron DIP coordinates.
3. Retire the replacement calculator as the intended UX. Preserve the installed original calculation paper's editor, engine, precision and existing interactions. Add chronological records with minimal changes around that original implementation. Treat local original binaries as build inputs, not source to publish. Preserve both old and newly created records.
4. Review diffs and verify in hidden source Electron using isolated profiles. Capture the original-style paper view separately for visual review. Build staged artifacts after validation.
5. Do not restart the currently used release or modify live plugin/data during development. Prepare a small, explicit cutover after the result is ready.

Acceptance: `utool` finds installed uTools; panel size survives relaunch, position follows the mouse, header moves while icons reorder; paper retains original calculation layout/behavior with only date history/new paper persistence added.

Status: uTools was absent from all 403 scanned shortcuts, not excluded by source filtering. A background-created Start Menu shortcut has already been detected by the active application's watcher. The general missing-shortcut discovery improvement is part of this staged release, not replaced by that immediate repair.

Original calculator comparison: source Electron tests confirm that 200000*1.5, 4/34, 30*1.15 and 0.1+0.2 produce the same visible results as the untouched installed bundle. The patched plugin changes only three version/hash-guarded integration anchors; original editor, calculation engine, precision and toolbar are retained. No original vendor bundle is committed.
