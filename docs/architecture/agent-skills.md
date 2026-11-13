# Agent skills

A skill is a markdown document (sub type `skill`) of instructions an agent
follows. Built-in system skills (`crates/system_skills`) work the same way but
have no document, and are never routed. A system skill can instead come with
an SDK area's guide (`agent_code_mode`'s `attached_skill`): Compose Routines
follows the routines guide wherever that guide goes, so a session asked for a
routine has it without looking; hosts without code get its routine-tools form.

## Descriptions

Every skill has a one-line description saying when to use it ("Use when …;
not …"), stored in `skill_description` (one row per skill document, at most
300 characters) and validated by `documents::domain::skill_description`.

- Creating a skill requires one: `POST /documents/create_skill`, the
  `CreateSkill` tool, `macro.documents.createSkill({description})` and the
  skill composer all reject a blank, multi-line, long or non-"Use when" line
  before creating anything.
- `GET`/`PUT /documents/{id}/skill_description` read and change it (View and
  Edit access); the web app edits it under an open skill's title.
- Skills made before descriptions existed have no row and route on their
  name alone, at a higher bar (below).

## Loading skills a request needs

Behind the `auto-skills` PostHog flag, `agent_inmem` routes each
conversation turn before it runs, in the same join as memory and SDK docs:

```
turn ─┬─ memory, SDK docs, auto model ...
      └─ skills::domain::selection::select_skills
           list ≤256 of the user's skills (soup, access-checked), newest first,
             with descriptions; skip ones this session loaded or the request @mentions
           ceil(n/32) parallel Jev calls (≤8): "Would skill X help? <description>"
           1 s deadline; a late or failed call loses only its own skills, and
             when none answers nothing loads and the turn runs as usual
           load ≥0.8 (≥0.95 without a description), at most 2, most relevant first
           read bodies through ReadSkill's access check, 1 s
      ▼
  SessionSkills remembers (request number, skill) per session (≤8, in memory)
  inject: each skill's <loaded_skills> block is appended to the user message
          that loaded it, in the model's copy of the conversation only
```

Keeping a skill on the request that loaded it keeps every earlier turn's
text identical, so the prompt cache holds, and the skill stays in effect for
the rest of the session without routing again. After a restart a session
routes again from its next message.

`agent.skill_selection` records `candidates`, `loaded` and `suggested` skill
ids, `top_score`, `bytes` and `selection_status`; never names or request text.

`route_evaluation` in `crates/agent_inmem/src/domain/skill_routing/eval.rs`
(ignored; needs `TYPESAFE_API_KEY`) routes 20 prompts over a fixture skill
set through the real Jev and prints the hit rate at several thresholds.
