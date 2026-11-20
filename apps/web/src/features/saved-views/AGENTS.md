# Saved views

## What it is

Reusable named view definitions. Consumers are main Tasks, Projects, and Email; the generic feature does not interpret consumer configuration.

## Start here

- `core/saved-view.ts`: resource vocabulary, without transport or UI types.
- `context/saved-views-source.ts`: independent list and detail read contracts.
- `queries/saved-views.ts`: `useSavedViews` for cursor paging and `useSavedView` for one definition; compose them at the host.
- `queries/saved-view-actions.ts`: independent create, update, delete, and reorder hooks using the shared GraphQL client, native mutation state, authoritative confirmation, and cursor reconciliation.
- `views/saved-view-dialogs.tsx`: one create/edit dialog owns separate mutation hooks, a shared wide responsive form, and lifetime checks; deletion keeps its confirmation.
- `components/`: presentational forms/confirmation, compound sidebar lists, and shared styled context/overflow items.
- `primitives/create-saved-view-draft.ts`: shared revision-aware baseline and retained-draft reconciliation; consumers provide their codecs, defaults, and setting application.
- `primitives/create-saved-view-creation.ts`: fresh local identities, consumer-kind draft ownership, and append-only draft/confirmed list entries.
- `views/saved-view-draft-host.tsx`: route-owned creation writes and owner-bound imperative leave confirmation.

## Boundaries

- Keep Task filters, navigation, and configuration decoding in `features/tasks-view`, Project definitions in `features/projects`, and Email definitions in `features/email-view`.
- Saved-view row order is personal and server-owned (`reorderSavedViews`); consumers show a pending move locally only until the list itself changes, never by splicing the cache. Email's containing `saved-views` sidebar section uses the shared view shell's local per-account section order; Tasks and Projects retain saved views in their built-in navigation sections.
- Readers re-read on focus, after a gateway reconnect, and on a `saved_views_changed` push for their kind (`queries/saved-view-changes.ts`), which is how writes made outside the page, such as an agent's, appear; the push carries no definition.
- Consumers pass the list's accessible label, row status (`trailing` plus `statusLabel`), drag wiring, and Move up/Move down handlers (Email passes them only where rows can't be dragged); rows never create drag items themselves, since only a desktop list mounts the drag provider. Tasks and Projects use Rename, Duplicate, and Delete menus; Email keeps its existing management labels.
- A consumer that edits definitions in the dialog passes `fields`, `invalid`, and a replacement `config`; edit without `config` keeps renaming and sharing only. `hint` renders the consumer's note under the name (Email uses it on create).
- Do not migrate CRM's legacy personal views or team settings into this consumer.
- Share definitions, not access to their matching entities; the backend owns authorization.
- Store icon and color on the shared definition, outside consumer config; only owners edit through the entity-appearance picker. Gate editing with `enableEntityAppearance`, never rendering, and preserve appearance through list/detail reads and temporary filter edits.
- Rebuild loaded cursor chains after confirmed membership changes; never invent permission state or splice a full page.
- Keep consumer edits on failed or stale saves; if edits arrive during initial creation, retain the draft and retry with the confirmed record's revision. Only matching confirmed writes replace the baseline, and Reset adopts the latest authorized definition withheld during editing.
- Keep same-viewer confirmed definitions through transient read errors; explicit unavailable data and account changes must hide the previous definition.
- Keep sharing guidance beside the checkbox as a focusable info control; support hover and tap without toggling sharing.
- Identify the saved view by name in edit and delete dialog titles; wrap long names on narrow screens.
- The create/edit form body scrolls as one, name included, with the actions below it and edge fades (`ScrollIndicators`) standing in for the hidden scrollbar; consumer fields must not add their own scroll area. Consumers may pass the delete confirmation's description in their own terms.
- Snapshot saved configuration when adapting query data; reconciled Solid stores must not mutate a confirmed draft baseline.
- Append task and project saved-view rows below each consumer's built-in views on desktop and touch, with Create view last and no saved-view section header or empty-state card.
- Start every Create view, captured Save view, or Duplicate with a fresh local identity at the end of its consumer list; confirmed saving replaces that row in place and discard removes it.
- Keep creation consumer-owned and forward the final Create view control ref so the host can isolate its keyboard scope.
- Set variant="ghost" and size="icon-xs" explicitly when Dropdown.Trigger renders ViewSidebar.Control so dropdown text-button defaults cannot stretch the 24px circle.
- Open task and project row actions through a long-press sheet on touch and a hover/focus More menu on desktop; reuse permission-aware actions and finish closure before opening dialogs.
- Suppress only the pointer click following a held row; keep keyboard and assistive activation usable after sheet dismissal.
- Confirm before leaving a dirty new draft through local selection, child navigation, pane/tab closure, or browser unload; clean drafts and existing saved views do not prompt. Use the split router's `useBeforeLeave` with the existing imperative confirmation for Discard or Keep editing, and native browser unload confirmation; never save from the leave prompt or discard before navigation commits.
- Bind deferred menu actions to the opening account and discard them after an account change.
- Validate the response viewer before exposing cached reads after an account change.
- Keep list and detail hooks independent; pass mutation dialogs a refresh callback, not an aggregate read source.
- Resolve the shared GraphQL client reactively inside read and mutation hooks; do not require callers to pass a client or mount a feature-local `UrqlProvider`.

## Checks

Run from `apps/web`:

- `bun run test src/features/saved-views src/features/tasks-view`
- `bun run type-check`
- `bun run gen-graphql` after schema or document changes.

## Related

- `docs/design/saved-views.md` at the repository root.
- `docs/architecture/frontend-features.md` and `docs/guides/add-graphql-field.md`.
