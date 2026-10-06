# Shared Changes viewer

`changes.tsx` is the shared entry for PRs, agent sessions, and previews. A host
supplies a `ChangesSource` and `ChangesHost`; `ChangesProvider` owns controller,
view-state, and dismissal setup. Shared UI never reads agent-session context.

```tsx
<ChangesProvider context={{ source, host }}>
  <ChangesSplit>
    <header><ChangesToggle /></header>
    <HostContent />
  </ChangesSplit>
</ChangesProvider>
```

`AgentChangesProvider` in `agent-session-changes.tsx` supplies the harness source,
linked PR metadata, and prompt-based note sending. `block-pr/component/PrChanges.tsx`
supplies the storage-service PR source and existing PR metadata without an agent
capability, so the same viewer stays read-only. Neither adapter duplicates the
shared controller setup or owns the other adapter's queries. `browser-host.ts`
provides clipboard, external navigation, and notifications explicitly at these
production boundaries; the generic provider has no implicit browser actions.

Give each host a stable `scopeKey` (for example, `pr:<foreign-entity-id>`) to isolate
persisted layout, collapse state, and notes. The optional `agent` capability enables
inline note creation and sending. The optional `canHaveChanges` accessor hides all
controls and the pane while false. The session adapter also gates its source, so
chat-only sessions and coding sessions without a linked PR make no changes requests.

`views/ChangesPane.tsx` composes the generic `FileTree`
(`@ui/components/FileTree`) and `DiffView` (`src/components/diff-view`) from the
controller: tree rows show status letters and counts, file headers add **Copy
path** with a brief, non-pulsing success checkmark for the latest copy request,
and review notes hang under their lines through `DiffView.Stack`'s annotation slot.
The file tree fills the body height, with its count on the left and the tree
visibility toggle on the right of a fixed header. Tree rows scroll independently below it.
The tree divider supports dragging and Left/Right keyboard resizing; its preferred
pixel width persists per host scope. Tree visibility uses the sidebar's shared
`CollapseTransition` on the width axis, with matching diff-column motion and
reduced-motion support. The divider stays visible but inert through exit, releasing
its layout space with the tree only when the animation finishes. Hiding retains
directory state and the diff stack. Starting a drag or keyboard resize, or resizing
the outer split or viewport, settles the visibility animation synchronously first.
At 720px or narrower, and on touch devices, the tree starts closed and opens over
the diff stack as a pane-local drawer, without reserving space or a divider.
**Show file tree** stays in the diff controls; file selection, Escape, the backdrop,
and the close toggle dismiss the drawer and restore focus to its opener.
Closing retains only an inert visual frame; dialog listeners release immediately.
Drawer state never changes saved wide-tree visibility or width. Directory and diff
owners survive responsive mode changes. The all-diffs collapse/expand button stays
in the floating diff controls; a hidden or drawer tree puts its count there too.
Another host composes the same components its own way.

Native PR and Agents workspace hosts put their title row and content together
inside `ChangesSplit`, so changes occupy the full height beside that row.
Host title, sharing, and sidebar actions remain available on the left. The Changes
button stays visible in split view: ghost while closed, accent text on a tinted
background while open, without the shared foreground pressed overlay; clicking
it again closes the pane. Below 28rem of the
header's named `split-header` container, only Changes becomes icon-only, retaining
its accessible name, tooltip, pressed state, and touch target. Breadcrumbs keep
their existing layout. The button has no diff totals; those appear beside the
pane's branch range and PR number in both split and full-width layouts. On a PR
detail, the diff count pill also opens the pane when a controller is available;
otherwise it remains a passive count. The pane slides in from the right edge on
open and completely off that edge on close, without fading in either direction.
In split view, the session shrinks alongside entry and expands alongside exit.
Reduced-motion preferences disable both animations.
Its resize panel stays registered until the exit animation completes; reopening
cancels exit without remounting the pane. Patch parsing and diff bodies are queued
after the pane shell mounts, and off-screen bodies wait until needed.
Split/full toggles retain the host and diff owners and restore the dragged split
ratio without replaying the visibility slide or reparsing unchanged patch text.
Hosts at 720px or narrower open Changes at full width and hide the width toggle,
without changing the saved split ratio or route layout. Widening restores the
requested wide layout and keeps the same conversation and diff owners.
A spotlight request during a slide applies after the slide settles. A full-width
slide reveals the retained host behind it rather than leaving empty space; a
reversal keeps that underlay until the pane finishes returning.
`ChangesPane` keeps pane actions beside the linked `head → base · #PR` metadata
in its header, without a visible Changes title. Diff controls float above the
stack inside the diff column, with Unified/Split on the left and collapse/refresh
on the right, without a full-pane toolbar or bottom border. The pane has no outer
top, right, or bottom border; the resize divider separates it from the host.
The metadata opens GitHub; narrow panes truncate the branch range. Unified/Split
retains its text labels at every non-touch width. The shared `DiffStats` shows
exact totals beside five subtly hatched green/red squares with inset edges,
summarizing the addition/deletion mix without animation.
At full width, the header adds a `text-sm` PR title with extra top padding before
the plain-text `text-xs` branch link, which underlines on hover.
When title and metadata do not fit together, the smaller branch/number/count group
wraps below the title; pane actions stay outside that wrapping group. Native PR
and session hosts supply titles and GitHub totals from existing queries; no extra PR fetch is needed.
Missing titles stay hidden, and unavailable GitHub totals never fall back to
captured estimates.
Legacy embedded agent hosts still render their frame-owned chrome above both
panes. Moving `AgentSplitHeader` does not change that portal placement; full-height
embedded changes require a separate host-layout migration.

The source owns fetching, cache identity, and conversion into the feature's core
changeset types. The PR page's adapter is `block-pr/data/pr-changes.ts`, over
`GET /github_pull_requests/{id}/changes` and `/changes/patch` in the storage
service; `block-pr/component/PrChanges.tsx` mounts it read-only under
`pr:<foreign-entity-id>` without an agent session.

Layout and diff style come from `createPaneViewState()` (`pane-view-state.ts`).
Where the host's route lists `changesSearch.namespace` in its `search`, they live
in that split's search params (`s0.changes.pane`, `s0.changes.style`), so the
split router drops them when the split closes or navigates away; anywhere else,
such as a preview, they are local signals.

## Lifecycle boundaries

- `createChangesModel` owns source enablement and retains displayed patch text for
  the same changeset during exit. Diff rendering never fetches a patch.
- Generic `DiffView.Root` owns queued patch parsing and its unchanged-text cache.
  `create-diff-reveal.ts` owns the stack's separate reveal queue, card registration,
  and viewport observation. Selection anchoring stays in `DiffView.Stack`, because
  later syntax highlighting also changes card heights. Each queue follows its
  Solid owner and disposes only when that owner unmounts.
- `create-split-presence.ts` separates visibility intent from retained pane presence
  and motion. `ChangesSplit` owns Resize registration and retained host content.
- `create-tree-layout.ts` owns tree presence and Resize-dependent companion frames.
  The view keeps the tree's owner and moves its DOM between wide and drawer docks.
- `create-animation-group.ts` shares cancellation, stale completion guards, and
  synchronous finish/release mechanics. It does not own mount policy or geometry.
  Pane translation and tree width collapse keep separate timing and presence policy.
- Drawer `Dialog.Content` releases on close immediately; only an inert visual frame
  survives exit. Do not retain the dialog just to retain the tree or its animation.

The `changes` route namespace, existing `agent-changes:*` storage prefixes, and
query-cache namespace remain unchanged after the feature rename. The debug gallery
also keeps its existing `agent-changes-ui` route ID.
