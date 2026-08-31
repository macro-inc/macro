# Browse files

Files lets a user open the workspace file list and find the seeded `Project Roadmap` document.

## Sub-features

- `files-open` opens Files from the workspace sidebar.
- `files-list` renders a complete file list or empty state without an app error.
- `files-seeded-document` shows `Project Roadmap` in the list.

## How to get to it (user POV)

- Choose `Files` in the workspace sidebar.
- Navigate directly to `/app/component/documents`.

## Driving it with Playwright

Preconditions:

- The isolated local E2E stack is seeded.
- `localE2ESeed.smoke.projectRoadmap` resolves to `Project Roadmap`.
- The browser is authenticated as `e2e@macro.local`.

- **Open Files.** Run `env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-smoke.spec.ts -- --grep "documents view shows seeded documents"`. The browser navigates to `/app/component/documents`.
- **Use the sidebar.** Run `env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-sidebar.spec.ts -- --grep "opens Documents from the sidebar"`. Playwright clicks `[data-sidebar-link="documents"]` and requires the Files route and list.
- **Confirm the view.** The test requires `[data-list-view="documents"]` to become visible.
- **Confirm seeded content.** The test searches `[data-soup-list-container]` for the row identified by the seeded document's `[data-entity-id]` and requires it to contain `Project Roadmap`.
- **Proof.** Keep `run.txt` and the resulting Playwright `.zip` trace archive. The trace must show the navigation action and visible seeded row.

## Gotchas

- The visible sidebar label is `Files`, while the route and data attributes use `documents`.
- The list is virtualized. Scroll the `[data-soup-list-container]` as `expectEntityInCurrentList` does instead of assuming the row is initially mounted.
- A visible list shell is not enough. Require the seeded document row.
