# skills

## What it is

Part of the agent sessions feature. Skill discovery and reading for AI
agents: skills are markdown documents (document sub type `skill`) whose
instructions an agent follows when the skill is referenced in its input.

## Start here

- `src/lib.rs` module doc: the crate's architecture summary (domain/inbound/outbound).
- `src/domain/ports.rs` + `src/domain/service.rs`: `SkillService` and its
  default implementation.
- `src/inbound/toolset.rs`: the three AI tools — `search_skills.rs`,
  `list_skills.rs`, `read_skill.rs`.
- `src/outbound/`: `document_skill_reader.rs` (reads skill content),
  `search_service_searcher.rs` (search), `soup_skill_lister.rs` (listing).

## Scope

- Owns: skill discovery/search/read as AI tools and their adapters.
- Not here: the skill document's own editor/storage surface → `documents`;
  how it's injected into a prompt → the agent harness.

## Boundaries

- Depends on: `document_sub_type`, `entity_access` (ports); `outbound` feature
  additionally needs `documents`, `search_service_client`, `soup`,
  `lexical_client`, `item_filters`, `filter_ast`.
- Used by: `ai_tools`.

## Recipes

- Add a skill tool: `src/domain/ports.rs` (port method) →
  `src/domain/service.rs` → `src/inbound/toolset/<name>.rs` → register in
  `src/inbound/toolset.rs`.

## Checks

- `cargo test -p skills` (`SQLX_OFFLINE` unset).

## Related

- Skill: `create-ai-tool`, `cloud-storage-hexagonal-architecture`
