# Sidebar navigation

The sidebar is Macro's primary navigation surface for inbox, agents, email, files, tasks, channels, calls, folders, and search.

## Sub-features

- `sidebar-open-view` opens each visible workspace destination.
- `sidebar-active-view` marks the selected destination active.
- `sidebar-loaded-view` renders the destination's list or empty state.
- `sidebar-tabs` shows each destination's expected tabs.
- `sidebar-search` exposes the Search view and search editor.

## How to get to it (user POV)

- Choose a destination in the sidebar.

## Driving it with Playwright

Preconditions:

- The isolated local E2E app is authenticated.
- The sidebar `nav` and split layout are visible.
- Feature flags may hide optional destinations, so use the destinations encoded by the current E2E test.

- **Exercise all mapped destinations.** Run `env -u CARGO_TARGET_DIR nix --extra-experimental-features 'nix-command flakes' develop --command bun .cursor/skills/verify-macro/scripts/run-proof.ts local-sidebar.spec.ts --`.
- **Choose a destination.** Each test clicks the destination's `data-sidebar-link`, such as `nav [data-sidebar-link="documents"]`.
- **Confirm navigation.** For Files, require `/app/component/documents`, the active link's `data-active` attribute, and `[data-list-view="documents"]`; the test applies the same checks to every listed destination.
- **Confirm loading.** Require either `[data-soup-list-container]` or `[data-soup-empty-state]` and reject `Something went terribly wrong`.
- **Confirm view chrome.** Require the tabs listed in `local-sidebar.spec.ts`. Search additionally requires `[data-soup-search]`.
- **Proof.** Keep the traces and run transcript. A destination is verified only when its own test passes.

## Gotchas

- The current E2E map calls the `documents` destination `Documents`, while the live sidebar can label the same route `Files`.
- Search is hidden from ordinary sidebar rows and opens from the header button or `/`.
- Optional Calendar, Customers, Calls, Activity, and Recent links are feature-gated outside this fixed local E2E matrix.
- A changed URL alone does not prove the view loaded. Require the list or empty state.
