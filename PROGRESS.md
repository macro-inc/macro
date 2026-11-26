# Project updates: round 5

- [x] Fresh saved-view drafts for every creation entry, appended to the owning list.
- [x] Discard / Keep editing before leaving dirty new drafts.
- [x] Desktop project task-list empty results retain Add task and Documentation.
- [x] Local unit tests, repository checks, review fixes, and audit.
- CI is requested after the final push; the PR's CI gate is the authoritative result.

## Verification

The affected unit suite passes. Web checks and `just check` pass. Review fixes
retain edits made during initial saving and keep Email draft initialization reactive.
CI identified paragraph descriptions included in the single-line menu-label
fixture; the fixture now excludes those descriptions without changing app text.
A cold CRM component import also exceeded a behavior test's time budget; it now
runs once in suite setup while the behavior assertions retain their normal limit.

Browser checks, signed-in checks, fixture browser suites, and screenshots are left
for the user. No further browser automation will run for this change.

The isolated `project-updates-r5` verification stack was stopped. The hosted-dev
preview remains available at the existing preview address.

## Main merge and cleanup

- Merged `origin/main` at `7546d65576`. Resolved `MobileDrawer.tsx` by combining
  navigation-driven dismissal with controlled snap points, rejected-dismissal
  restoration, and the keyboard-stable Discussion sheet.
- Removed 49 branch-only test and browser-fixture files; retained all files
  already present on main and removed obsolete suite commands.
- Open project-title rename/delete and saved-view leave confirmation through
  the imperative dialog host with owner-bound cleanup and permission checks.
- Use `Show` for conditional JSX and resolve repeated JSX children once; retain
  Discussion's render callback without evaluating it outside its provider.
- Separate project-route decoding from Back history behavior; retain nested
  task returns, direct-link fallbacks, list state, and phone/tablet behavior.
- Local validation: 307 test files and 2,427 tests passed, together with web
  checks and `just check`. Browser/device checks remain assigned to the user.
- Request and review CI after pushing; completion requires a passing gate on
  the latest commit.

## Page-owned mobile creation

- Removed project-route parsing and the project foreground hook from the
  generic mobile creation controls.
- The existing page Task menu owns the accessory through `FloatRegion`; the
  shared action returns when the page contribution is unavailable. No project
  placeholder suppresses the shared fallback.
- Retained the existing floating-region priority and pane-lifetime behavior;
  no new shared registry or feature-specific option was added.
- Latest local validation: 376 test files and 3,048 tests passed after the main
  merge, together with web checks and `just check`.
- Browser/device verification remains assigned to the user. The hosted preview
  stays running, and CI is requested for the final pushed commit.

## Saved-view appearance merge

- CI could not start after main advanced; merged `origin/main` at `907ceac49c`.
- Preserved draft ordering and leave guards alongside shared appearance editing.
  Saved rows keep keyed identity, and live icon/color updates do not reset dirty
  filters. Duplicates copy appearance once when the draft starts.
- Resolved conflicts in the shared saved-view list, menu, and dialogs; Email's
  saved-view page and guide; Tasks' header, draft adapter, saved-view page, and
  guide; and the task agent guide.
- Initial verification hit unresolved markers and type mismatches; those are
  resolved, and the final local checks above pass.
- The ordinary global action intentionally returns when a project action is
  unavailable; no project-specific placeholder suppresses it.

## Saved-view leave confirmation

- Simplify saved-view navigation to the split router's `useBeforeLeave` and the
  existing imperative confirmation dialog: Discard continues; Keep editing stays.
- Remove the extra draft-leave coordinator, shared three-choice dialog, and their
  save path. Restore scheduling's existing behavior rather than retaining an
  unrelated shared abstraction. Keep commit-only discard, draft-owned dialog
  lifetime, and native browser unload confirmation.
- Local validation: 209 test files and 1,603 tests passed, web checks, type-check,
  `just check`, and PR privacy checks passed. Review found no concrete regression.
- Initial validation failures were a keyed-Show callback type, test guard order,
  and test import formatting; each was corrected and the affected checks rerun.
- Browser and device verification remain assigned to the user.

## Superseded leave confirmations

- Release a cancelled confirmation synchronously so a newer navigation can ask
  immediately. A settled older request cannot clear the replacement prompt.
- The regression failed before the fix because the second prompt never opened.
  The focused router suite now passes all 23 tests.
- Browser and device checks remain assigned to the user.

## Sidebar section-order merge

- Merged `origin/main` at `726276100c`, retaining shared per-account sidebar
  section ordering alongside project saved views and guarded navigation.
- Resolved `TasksSidebar.tsx` by grouping built-in and saved task views inside
  the shared headerless section; project views remain in the Projects section.
- Combined the Email, saved-view, and Tasks guides and the Tasks agent guide
  without restoring obsolete standalone saved-view sections for Tasks.
- Local validation: web checks and `just check` passed; 3,631 tests across
  450 files passed. Browser and device verification remain assigned to the user.
- CI will be requested after the merge commit is pushed.
