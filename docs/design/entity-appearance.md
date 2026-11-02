# Entity appearance

## Scope

Customize routines, ordinary Markdown documents, snippets, task projects
(initiatives), forms, and databases. Exclude tasks, skills, internal collab
documents, Drive folders, and other file types.

Appearance belongs to the shared entity, not the viewer. Every identity surface,
including public/read-only views, uses the saved appearance. Navigation category
icons and task status icons retain their existing behavior.

## Contract

The shared Rust `model_entity::EntityAppearance` contains an optional icon and
an optional theme-aware palette key. Icons are distinct original Macro SVG names
or single native emoji. Emoji retain native colors. Each entity domain owns its
nullable JSON field, eligibility, authorization, writes, and lifecycle.

Edits require existing edit access; routines remain owner-only. Metadata-only
writes do not change content timestamps or execution configuration revisions.
Appearance travels with entity reads, rather than fetching per rendered icon.
Headers and breadcrumbs use the lightweight preview identity selection, without
loading document properties.
Existing duplication/template flows copy appearance; blank creation uses defaults.
Published routine templates retain snapshot semantics.

The icon catalog comes from `tooling/icons/generate-entity-icons.ts`. Generate
wire types from the Rust schemas, not hand-written frontend DTOs.

## Editing

Header icons and existing entity menus open the same lazy editor. Desktop uses
a 344px anchored popover; mobile uses a bottom sheet. Document titles place a
custom icon inline, or show Add icon before the other title pills for editors.
Row and breadcrumb icons retain navigation behavior. Popup loading stays inside
the dialog's Suspense boundary without suspending the surrounding app.

Each icon, emoji, color, or Remove pick saves immediately through the existing
optimistic, per-entity serialized path. The picker stays open; dismissal does
not undo picks. A failed save restores the last successful choice unless a newer
choice is pending. Async completion stays scoped to the opening account.

Icons are grouped, with up to nine account-scoped recent picks first. Picker-only
curation excludes layout/editing glyphs without changing the stored catalog.
Icon search also matches emoji; the Emoji tab groups the shared emoji catalog
and pins category navigation. Arrow keys move between cells and Enter selects.

Colors appear only on Icons. Default is a ring in the entity type color, followed
by the nine palette colors. Remove clears only the icon. There is no draft,
preview header, Reset all, or Apply/Cancel footer.

## History

Record appearance changes as distinct entity-history activity. Exclude these
entries from broader activity feeds, notifications, and attribution/recency
ranking. Render entries in existing history views only; add no new history UI.
Persist attributed history in the same transaction as the appearance write.
Appearance broker events refresh other readers without inserting duplicate history.
