# Entity appearance

## Scope

Customize routines, ordinary Markdown documents, snippets, task projects
(initiatives), forms, and databases. Exclude tasks, skills, internal collab
documents, Drive folders, and other file types.

Appearance belongs to the shared entity, not the viewer. Every identity surface,
including public/read-only views, uses the saved appearance. Navigation category
icons and task status icons retain their existing behavior.

## Rollout

The PostHog flag `enable-entity-appearance` gates web editing only. It defaults on
in development and supports the `VITE_ENABLE_ENTITY_APPEARANCE` override. While
loading or disabled, hide editing controls; disabling closes open pickers. Saved
icons and colors remain visible, and API/SDK access and edit permissions stay
unchanged. Configure the remote rollout separately; an absent flag stays off
outside development.

## Contract

The shared Rust `model_entity::EntityAppearance` contains an optional icon and
an optional named key from the shared tag color palette. Icons are distinct
original Macro SVG names or single native emoji. Emoji retain native colors.
Each entity domain owns its nullable JSON field, eligibility, authorization,
writes, and lifecycle.

Edits require existing edit access; routines remain owner-only. Metadata-only
writes do not change content timestamps or execution configuration revisions.
Appearance travels with entity reads, rather than fetching per rendered icon.
Headers and breadcrumbs use the lightweight preview identity selection, without
loading document properties.
Existing duplication/template flows copy appearance; blank creation uses defaults.
Published routine templates retain snapshot semantics.

Generate wire types from the Rust schemas, not hand-written frontend DTOs.
Unknown wire colors retain the icon and use the type color; unknown icon kinds
retain valid colors.

## Icon catalog maintenance

Entity artwork lives only in `apps/web/src/components/icon/entity/`, separate
from interface controls. The initial catalog contains 266 original drawings;
its approved SVG bytes are preserved, including code-file drawings. The initial
unreleased allowlist reset replaces the previous UI-folder-derived catalog.

`tooling/icons/entity-icon-sections.json` owns picker order, section labels, and
icon nouns. Tooltips show those nouns; search matches nouns and stored names.
`tooling/icons/generate-entity-icons.ts` produces the Rust allowlist, web catalog,
and English labels. `tooling/icons/entity-icon-names.json` records permanent
names and grows when new drawings or aliases are added.

- Add an SVG to the entity folder, regenerate, add its name and noun to a section,
  and regenerate again. Deploy server support before or with the web picker.
- Redraw under the existing name; do not change identity to change artwork.
- Retire a drawing by removing its section entry. It stays valid and renderable
  but never appears in the picker or Recent.
- To rename, map the old name directly to an existing drawing in
  `tooling/icons/entity-icon-aliases.json`. The server accepts both names; the
  client renders the target. Alias chains and picker entries for aliases fail.
- Never delete a permanent name without an explicit data migration. Generation
  checks every committed name list, so trimming the manifest cannot bypass the
  guard. Missing names require aliases; shallow clones must fetch full history.
- Run `bun tooling/icons/generate-entity-icons.ts --check` and
  `bun test tooling/icons/generate-entity-icons.test.ts`. Generation rejects
  identical geometry after removing icon metadata and normalizing whitespace,
  rather than silently dropping a drawing.

## Editing

Header icons and existing entity menus open the same lazy editor. Desktop uses
a 344px anchored popover; mobile uses a bottom sheet. Document header icons are
editable controls separate from breadcrumb name navigation. Document content
titles have no leading icon; Add icon appears before the other title pills when
unset. Row icons retain navigation. Popup loading stays inside the dialog's
Suspense boundary without suspending the surrounding app.

Each icon, emoji, color, or Remove pick saves immediately through the existing
optimistic, per-entity serialized path. The picker stays open; dismissal does
not undo picks. A failed save restores the last successful choice unless a newer
choice is pending. Async completion stays scoped to the opening account.

Icons use fourteen curated sections, with up to nine account-scoped recent picks
first. Recent includes only currently selectable names. Icon search matches
stored names, nouns, and emoji. Both catalogs and search results use virtualized
rows; keyboard navigation reaches unmounted rows, and focused choices survive
Recent reordering. The Emoji tab groups the shared catalog and pins category
navigation. Both tabs show a compact shared-visibility footer. Arrow keys move
between cells and Enter selects. Editing actions read “Change icon” without an
ellipsis or a leading menu icon.

Colors appear only on Icons. Default is a ring in the entity type color, followed
by the same twelve fixed colors as tags, in tag-palette order; swatches wrap in
narrow panes. Remove clears only the icon. There is no draft, preview header,
Reset all, or Apply/Cancel footer.

## History

Record appearance changes as distinct entity-history activity. Exclude these
entries from broader activity feeds, notifications, and attribution/recency
ranking. Render entries in existing history views only; add no new history UI.
Persist attributed history in the same transaction as the appearance write.
Appearance broker events refresh other readers without inserting duplicate history.
