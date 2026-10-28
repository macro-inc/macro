---
name: collab-surface-core
description: Use when adding collaborative markdown, notes, or descriptions to a feature with collab surfaces. Covers parent entities, service entry points, authorization, content storage, and lifecycle.
---

# Collab surface core

Use collab surfaces for collaborative markdown within a feature. Each surface
has its own Loro session in sync-service and can exist without a `Document` row.
The surface is a child resource of an app entity: product names, owners, sharing,
and discovery belong to the parent.

## Choose the entry point

- **A field managed by its parent domain**, such as an initiative description:
  use `OwnedSurfaceService` through the feature's domain port. The owning domain
  authorizes callers and chooses the surface id before calling
  `ensure_owned_surface`, `owned_surface_markdown`, or `retire_surface`.
- **A surface managed through the public API**, such as a channel's shared input:
  use `CollabSurfaceService` with an access receipt for the parent. Surface reads,
  connection tokens, and deletion derive their permissions from that parent.

Check `surface_ownership` and the parent's access resolution when adding a new
parent type. Parents marked `ParentDomain` use their domain's creation and
retirement paths; the public API still provides connection tokens. Keep the
trusted `OwnedSurfaceService` behind domain authorization, with adapters supplied
by the composition root.

## Keep content and lifecycle with their owners

- The Loro session is the source of truth for content. `collab_surfaces` records
  the id, parent, initialization state, timestamps, and soft deletion.
- Use application-generated UUIDv7 ids and the service's ensure operation. It
  handles namespace collisions and retries initialization from `pending` to
  `ready`. The id also names the sync session and must never be recycled.
- Initial markdown seeds a new session. Ensuring an existing surface preserves
  its content; subsequent edits go through the collaborative session.
- Wire retirement into the owning feature's cleanup. The parent reference is
  polymorphic and has no foreign-key cascade. Retirement blocks new connection
  tokens; it does not reclaim the sync-service session.

Read the [domain ports](../../../crates/collab_surface/src/domain/ports.rs) and
[parent policy](../../../crates/collab_surface/src/domain/models.rs) before wiring
a consumer. The [initiative adapter](../../../crates/initiative_description/src/lib.rs)
shows how a feature reuses the service through its own domain port.
