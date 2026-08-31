# Search

Search lets a user find a seeded file, open the result, and return without losing the query.

## Sub-features

- `search-open` opens Search from its route.
- `search-result` returns `Project Roadmap` for its title.
- `search-open-result` opens the focused result.
- `search-restore` restores the query after in-app back navigation or a sidebar detour.

## How to get to it (user POV)

- Navigate directly to `/app/component/search`.

## Driving it with Playwright

Preconditions:

- The isolated local E2E stack contains the seeded `Project Roadmap`.
- `[data-soup-search] [contenteditable]` is visible.
- The split layout has focus before keyboard navigation.

- **Search and restore after opening.** Run `env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-search-state.spec.ts -- --grep "restores the query after opening a result"`.
- **Enter the query.** Playwright clicks the search contenteditable and types the seeded document name.
- **Open the result.** The test waits for the seeded `[data-entity-id]`, focuses `[data-split-container]`, presses `ArrowDown`, then `Enter`.
- **Return.** Playwright presses `Alt+BracketLeft`, Macro's in-app history shortcut.
- **Confirm restoration.** The URL returns to `/app/component/search` and `[data-soup-search]` contains `Project Roadmap`.
- **Alternate sidebar path.** Run `env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-search-state.spec.ts -- --grep "restores the query after switching sidebar views"`. It uses a separate instance and proof directory, then verifies a Files detour also restores the query.
- **Proof.** Keep the trace that contains query entry, result navigation, back action, and restored query.

## Gotchas

- Search uses a contenteditable, not a native input.
- A single result click selects the row. The mapped flow uses `ArrowDown` and `Enter` to open it.
- Use `Alt+BracketLeft` for Macro's split history. Browser back exercises a different URL reconciliation path.
- Wait for the seeded result, not a fixed delay.
