# system_skills

## What it is

Agent skills: Macro's built-in skills, available to every user. Each is
static text composed with the `prompt` crate, not a document, so no one can
open or edit it; its id is derived from its slug.

## Start here

- `src/lib.rs`: `SystemSkill`, the `SYSTEM_SKILLS` registry, lookup by id.
- `src/compose_routines.rs`: Compose Routines, writing a routine from a
  chat, and the example of a skill that comes with an SDK area's guide.

## How a skill reaches a session

- Listed and read: `SYSTEM_SKILLS` puts each skill's id and name in
  `ListSkills`/`SearchSkills` (`crates/skills`) and the web app's skills menu
  (`GET /documents/system_skills`); `ReadSkill`, `ReadContent` and skill
  attachments (`crates/documents`) return its `content` (`PROMPT` for
  Compose Routines).
- Never routed: `auto-skills` routing picks only skill documents.
- Carried by a guide: `agent_code_mode`'s `attached_skill` appends a skill to
  an SDK entity's guide wherever that guide goes, outside the byte budgets.
  Compose Routines rides on the `routines` guide, as `CODE` in code mode and
  `DIRECT` on hosts that save routines with the routine tools.

## Recipes

- Add a skill: a module exporting `SKILL` (slug, name, a prompt section
  titled with the name) → register it in `SYSTEM_SKILLS`.
- Have it come with an SDK area's guide: add the entity to
  `agent_code_mode::domain::documentation::attached_skill`.

## Checks

- `cargo test -p system_skills`
- If you change Compose Routines: `cargo test -p agent_code_mode`, and its
  example step's type check, with the pinned Deno on `PATH`:
  `cargo test -p agent_harness_service --bin agent_harness_service --
  --include-ignored every_catalog_routine_and_example_step_type_checks`.

## Gotchas

- A slug is permanent: renaming it changes the skill's id, which
  attachments and mentions refer to.
- How to write a routine lives in `routine_program`: `WRITING` is
  `ROUTINE_RULES` + `CODE_STEPS`. Compose Routines ends with `WRITING`
  (`DIRECT` with `ROUTINE_RULES`, since `CreateRoutine`'s description carries
  `CODE_STEPS`); the drafter and suggestion briefs take `ROUTINE_RULES` and
  add `CODE_STEPS` when code steps can be written. The skill adds only how a
  session finds, checks, saves and reports.

## Related

- Docs: `docs/architecture/agent-skills.md`
