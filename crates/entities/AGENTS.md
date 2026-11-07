# crates/entities

## What it is

Entities and sharing: entity access checks and their stores, sharing and permission grants, roles, access requests, the entity registry, foreign entities, entity mutations, favorites and frecency.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`access_requests`](access_requests/AGENTS.md) | Owns initial access requests and upgrades, owner review, and direct user grants for supported shared entities. |
| [`entity_access`](entity_access/AGENTS.md) | Shared infrastructure used across nearly every feature: entity access control for cloud storage, checking a user's or bot's access level to any entity (documents, chats … |
| [`entity_access_db_utils`](entity_access_db_utils/AGENTS.md) | Shared infrastructure backing entity access across every feature: transactional helpers for the shared `entity_access` table — insert grant rows, and the … |
| [`entity_access_management`](entity_access_management/AGENTS.md) | Shared infrastructure backing entity access, mainly for the Projects feature: manages `entity_access` row updates triggered by entity lifecycle events — adding/removing … |
| [`entity_mutation`](entity_mutation/AGENTS.md) | Shared infrastructure used across every entity-owning feature: the canonical mutation vocabulary (`rename`, `move`, `trash`, `restore`, `duplicate`, `permanently … |
| [`entity_registry`](entity_registry/AGENTS.md) | Shared infrastructure used across every owned-entity feature: the owning crate for the `entity` table, recording one owner per in-scope resource, plus the owner-grant … |
| [`entity_registry_db_utils`](entity_registry_db_utils/AGENTS.md) | Shared infrastructure used across every owned-entity feature: transactional writes to the `entity` table, for callers to run inside their own resource-row transaction. |
| [`favorites`](favorites/AGENTS.md) | Backs favoriting/pinning across Macro surfaces (sidebar, Home/Soup): user- and team-scoped ordered collections of entities, following the hexagonal architecture pattern. |
| [`foreign_entity`](foreign_entity/AGENTS.md) | Shared infrastructure used across many product features (GitHub PRs, Soup, documents, memory, AI tools): generic CRUD storage for records sourced from a third-party … |
| [`frecency`](frecency/AGENTS.md) | A facade that re-exports the split frecency crates under their old module paths (`frecency::domain` = `frecency_core`, `frecency::outbound` = `frecency_outbound` … |
| [`frecency_core`](frecency_core/AGENTS.md) | Shared infrastructure for Search/Soup ranking and other item lists: frecency (frequency + recency) scoring. |
| [`frecency_inbound`](frecency_inbound/AGENTS.md) | Part of frecency scoring: the polling worker that periodically drives `frecency_core`'s event aggregator and persists aggregate scores. |
| [`frecency_outbound`](frecency_outbound/AGENTS.md) | Part of frecency scoring: the adapters behind `frecency_core`'s ports. |
| [`roles_and_permissions`](roles_and_permissions/AGENTS.md) | Part of shared infrastructure. |
| [`share_permission_db_utils`](share_permission_db_utils/AGENTS.md) | Part of shared infrastructure (sharing and permissions). |
| `shared_entity_registry` |  |

## Recipes

- Add a crate here: create `crates/entities/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
