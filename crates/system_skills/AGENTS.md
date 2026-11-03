# system_skills

## What it is

Part of agent skills: built-in skills defined in code, not as documents.
`Listed` skills appear in the `/` skills menu; `AgentOnly` skills carry an
area's guidance (databases, email, ...) that agents load when a request needs
it. Design: `docs/design/auto-skills.md`.

## Start here

- `src/lib.rs`: `SystemSkill`, `SYSTEM_SKILLS`, `listed()`, `catalog()`,
  `inline()`.
- `src/configure_agent.rs`: a complete skill module to copy.

## Scope

- Owns: built-in skill text, routing descriptions, and their ids.
- Not here: serving skills as tools → `crates/skills`; the menu endpoint →
  `crates/documents` (`axum_router/system_skills.rs`); composing prompts →
  `crates/ai_tools` and `crates/prompt` (a skill renders as a prompt section).

## Recipes

- Move an area's guidance out of `crates/prompt`: `git mv` its text to
  `src/<slug>.md`, add an `AgentOnly` skill → drop the section from the
  `crates/prompt` chains (hosts get it from `ai_tools`) → drop the area from
  `PLANNED` in `agent_inmem`'s `route_evaluation` and rerun it.
- Add a skill: `src/<slug>.rs` exporting `SKILL` → register in
  `SYSTEM_SKILLS` → its `tools` must be deferred session tools (checked in
  `ai_tools`) and its `sdk_entities` real SDK entities (checked in
  `agent_code_mode`).

## Checks

- `cargo test -p system_skills`
- If `tools` changed: `cargo test -p ai_tools --lib system_skill_tools`
- If `sdk_entities` changed: `cargo test -p agent_code_mode --lib system_skill_entities`

## Gotchas

- The id is the UUIDv5 of the slug: renaming a slug changes the id and
  breaks saved mentions of the skill.
- `description` is all the router sees. Start it with "Use when", keep it
  under 300 characters, and say what it is not for when a neighbouring skill
  is easy to confuse with it.

## Related

- Skills: `create-ai-tool` · Docs: `docs/design/auto-skills.md`
