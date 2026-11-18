# Project updates: round 5

- [x] Fresh saved-view drafts for every creation entry, appended to the owning list.
- [x] Save / Discard / Cancel before leaving dirty new drafts.
- [x] Desktop project task-list empty results retain Add task and Documentation.
- [x] Local unit tests, repository checks, review fixes, and audit.
- CI is requested after the final push; the PR's CI gate is the authoritative result.

## Verification

The affected unit suite passes. Web checks and `just check` pass. Review fixes
retain edits made during initial saving and keep Email draft initialization reactive.
CI identified paragraph descriptions included in the single-line menu-label
fixture; the fixture now excludes those descriptions without changing app text.

Browser checks, signed-in checks, fixture browser suites, and screenshots are left
for the user. No further browser automation will run for this change.

The isolated `project-updates-r5` verification stack was stopped. The hosted-dev
preview remains available at the existing preview address.
