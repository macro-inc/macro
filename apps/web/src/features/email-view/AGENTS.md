# Email view

## What it is

Mail's list view: desktop sidebar and header, mobile pills and filter drawer,
the Soup-backed thread list, and saved email views (flag
`enable-email-saved-views`).

## Start here

- `email-view-context.tsx`: view state, tab and thread navigation, the
  `mail.savedView` URL id, and saved-view selection.
- `queries/email-query.ts`: each tab's or saved view's Soup `ef` filter.
- `queries/use-email-query.ts`: list, search, read admission, local drafts.
- `filters/email-saved-view.ts`: the `kind: "email"` definition codec: strict
  capture, permissive read with skipped-setting issues, materialization,
  canonical comparison, templates, and scope resolution.
- `primitives/create-email-saved-view-draft.ts`: confirmed baseline, dirty
  state, and revision-aware reconciliation.
- `views/email-saved-views.tsx`: sidebar section, mobile picker, menus, the
  builder dialog, header actions, unavailable and skipped-setting states.

## Gotchas

- A saved view opens on All. Its Status, Done, attachment, calendar, tag and
  inbox filters live in the normal state so the Filters menu, inbox picker,
  and read admission keep working; its other conditions live in
  `state.conditions`, edited only in the builder.
- Never query while a selected view is loading, unavailable, or names `Me`
  before the inbox links load: that lists all mail under the view's name.
- Keep inbox reconciliation off while a view is open; an inbox no longer
  linked matches nothing instead of widening to every inbox.
- `beforeSavedView` restores the prior tab and inboxes on leaving, and is what
  local persistence saves while a view is open; never persist view filters as
  the user's own.
- Search inside a view intersects search hits with the view's own GraphQL
  predicate, as aliases do; local working copies are left out.
- Build participant and subject ORs as balanced trees; a flat OR exceeds the
  ingress depth limit.
- Unread dots are presence in a small first unread page per view, never a count.

## Checks

Run from `apps/web`:

- `bun run test src/features/email-view src/features/saved-views`
- `bun run type-check`

## Related

- `docs/design/saved-views.md` and `docs/agent-guide/email.md` at the
  repository root.
