# Saved views

## What it is

Reusable named view definitions. The first consumer is main Tasks; the generic feature does not interpret consumer configuration.

## Start here

- `core/saved-view.ts`: resource vocabulary, without transport or UI types.
- `context/saved-views-source.ts`: independent list and detail read contracts.
- `queries/saved-views.ts`: `useSavedViews` for cursor paging and `useSavedView` for one definition; compose them at the host.
- `queries/saved-view-actions.ts`: independent create, update, and delete hooks using the shared GraphQL client, native mutation state, authoritative confirmation, and cursor reconciliation.
- `views/saved-view-dialogs.tsx`: one create/edit dialog owns separate mutation hooks, a shared wide responsive form, and lifetime checks; deletion keeps its confirmation.
- `components/`: presentational forms/confirmation, compound list, shared styled context/overflow items, and mobile picker.

## Boundaries

- Keep Task filters, navigation, and configuration decoding in `features/tasks-view`.
- Do not migrate CRM's legacy personal views or team settings into this consumer.
- Share definitions, not access to their matching entities; the backend owns authorization.
- Rebuild loaded cursor chains after confirmed membership changes; never invent permission state or splice a full page.
- Keep consumer edits on failed saves; only confirmed writes replace the baseline.
- Keep sharing guidance beside the checkbox as a focusable info control; support hover and tap without toggling sharing.
- Identify the saved view by name in edit and delete dialog titles; wrap long names on narrow screens.
- Snapshot saved configuration when adapting query data; reconciled Solid stores must not mutate a confirmed draft baseline.
- Mount picker menus inside the drawer portal scope, close menus before opening dialogs, then close the drawer and restore focus before opening another dialog.
- Render the mobile picker trigger with the shared pill button and preserve the selected state supplied by its consumer.
- Compose unsaved list entries with the draft row; keep draft lifecycle and confirmed-record reconciliation in the consumer.
- Keep header creation consumer-owned and forward its control ref so the host can isolate its keyboard scope.
- Bind deferred picker actions to the opening account and discard them after an account change.
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
