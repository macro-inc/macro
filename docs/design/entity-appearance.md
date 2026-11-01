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
an anchored compact popover; mobile uses the existing sheet primitives. Row icons
retain navigation behavior. Popup loading stays inside the dialog's Suspense
boundary without suspending the surrounding app.

The editor offers Icons/Emoji tabs, search, a grid, palette swatches, independent
icon/color defaults, and Reset all. Preview stays inside the picker. Cancel
before Apply discards the draft. Apply updates visible readers optimistically
while saving both choices together. A failed save restores the previous appearance
and retains the draft for retry. Async completion stays scoped to the opening
account and never overwrites a newer edit.

## History

Record appearance changes as distinct entity-history activity. Exclude these
entries from broader activity feeds, notifications, and attribution/recency
ranking. Render entries in existing history views only; add no new history UI.
Persist attributed history in the same transaction as the appearance write.
Appearance broker events refresh other readers without inserting duplicate history.
