# Automatic skills

Status: proposal. Nothing here is built yet.

## Goal

Agents should follow a skill whenever a request needs it, without the user
attaching it with `/`. For example, "draft the release notes" should use the
user's "Release notes" skill. A request that no skill covers should load
nothing.

## What exists

- A skill is a markdown document whose sub type is `skill`. Its only metadata
  is its name. There is no description and no trigger
  (`crates/skills/src/domain/model.rs`). Visibility follows ordinary document
  access: skills the user owns, skills shared with them, and skills in their
  projects. Three system skills are defined in code (`crates/system_skills`).
- `ListSkills` returns at most 100 skills, as id and name only.
  `SearchSkills` matches names only. `ReadSkill` returns the body after an
  access check. All three are eager, direct tools, in code mode as well.
- Agent sessions do not resolve skill mentions. The model sees the mention
  and has to call `ReadSkill` itself. Legacy chat resolves a mention into an
  attachment tagged `<metadata key=type value=skill/>`.
- Nothing finds a skill automatically. Unless a skill is attached, the model
  has to decide on its own to search for one, and it searches by name.
  `apps/docs/product/skills.mdx` already promises that agents use a matching
  skill without it being attached.
- Jev (`crates/jev`) is a cheap yes/no classifier. It answers at most 32
  questions per call, has no prompt cache, and costs $0.042 per million input
  tokens. Agent sessions already call it before each turn:
  - Auto model choice (`agent.auto_model`).
  - SDK docs selection (`select_documentation`): one question per SDK entity,
    a 1 s deadline, a 0.5 threshold, the top 4 entities, and the result
    placed in the turn part of the system prompt. It runs alongside the memory
    fetch, so it adds no wall time on its own.
- Prompt layout (`agent::SystemPrompt`): the `shared` part is the same for
  every session and is the Anthropic cache breakpoint. `rest` is per session.
  `turn` comes last, so changing it costs only the tokens after it.

## Prior art

- **Agent Skills** (Claude Code, the Claude API): each skill has a required
  `name` and a `description` written as "what it does and when to use it". The
  name and description of every skill are always in the system prompt, and
  the model loads a skill's body with a tool call when it decides the skill
  applies.
- **Cursor rules**: "Agent Requested" rules work the same way, by description.
  "Auto Attached" rules are routed by file glob before the turn.
- **Macro's deferred tools**: a `- Name: first sentence` catalog in the prompt,
  with the schema loaded on demand. Same idea, applied to tools.

## Options

**(a) Catalog only.** Put every skill's name and description in the prompt.
The model calls `ReadSkill` when one applies.

- Accuracy depends on the turn's model. The default Auto model is Gemini
  Flash, which is weaker at deciding to load something on its own than Claude
  is.
- Every skill use costs an extra model round trip before the real work
  starts.
- The catalog is per user, so it cannot go in the cached `shared` part. It
  belongs in `rest`.
- It grows linearly with the number of skills: 100 skills at about 30 tokens
  each is roughly 3k tokens on every turn.
- It needs no new per-turn call.

**(b) Jev router.** Before the turn, ask Jev one question per skill ("Would
skill X help with this request? Use when …") and put the bodies of the
matching skills in the `turn` part of the prompt.

- The skill is in context on the first model call, with no extra round trip.
  This works the same for every turn model.
- It reuses the `select_documentation` code path, deadline and span shape.
  Jev's cost is negligible, and the call is hidden behind the memory fetch.
- A missed or wrong pick gives the model no fallback, and a wrongly loaded
  skill is worse than a wrongly loaded SDK doc, because the model is told to
  follow it.
- Jev answers 32 questions per call, so more skills need parallel calls, and
  past some count a shortlist.

**(c) Hybrid (recommended).** Jev pre-loads the bodies of skills it is
confident about, and a compact catalog of the user's other skills lets the
model load one that Jev missed.

## Recommendation: (c)

Per agent-session turn, in `drive_turn`'s existing `tokio::join!`:

1. **Candidates.** Fetch the user's skills with their descriptions through the
   existing access-checked lister, plus the system skills. Skip the whole step
   when the message already mentions a skill; the user's explicit choice wins.
2. **Route.** Send one Jev decision with the last user message, plus the
   previous one so that "now do it for Q3" keeps its skill. Ask one question
   per candidate, as name plus description. Up to 64 candidates, the most
   recently updated, are split into parallel calls of 32. The deadline is 1 s.
3. **Load.** Read the bodies of skills scoring at least 0.8, at most 2 of
   them, within a 16 KiB budget, through the `ReadSkill` service so that every
   read passes the access check. Put them in `turn` as
   `<skills_for_this_request>`, with the rule that they apply to this request
   only. Skills that score at least 0.5 but are not loaded are listed there by
   name and id.
4. **Catalog.** Put the name and description of the other candidates in
   `rest`, at most 64 lines, so the model can still `ReadSkill` one Jev missed.
   Past 64 skills, `SearchSkills` remains the way to find the rest.
5. **Failure.** On a timeout, a Jev error, or no cognition service, load
   nothing and keep the catalog. The turn never waits longer than the deadline.

The 0.8 threshold and the limit of 2 skills are starting points. The
evaluation below calibrates them. A wrongly loaded skill costs more than a
wrongly loaded SDK reference, so the threshold sits above the docs path's 0.5.

### Metadata

Add a `description` to skills: required, plain text, at most 300 characters,
written as "Use when …". Claude Code's guidance is the reason: the description
is the only thing the router sees.

- Store it in the database: a `skill` row keyed by `document_id`, next to
  `document_sub_type`. Do not put it in front matter in the body. The router
  reads every candidate on every turn, and reading the body of each one
  through lexical is too slow.
- `create_skill`, `CreateSkill`, `DocumentNamespace.createSkill` and the
  ComposeSkill popover take the description, and editing a skill can change
  it. System skills get descriptions in code.
- An existing skill without a description is routed by name only, and the UI
  asks for a description. No backfill.

### Scope

- **Agent sessions** (`agent_inmem`), in both direct and code mode. Skill
  reading stays a direct tool in both.
- **Legacy chat and the channel bot**: the same function, wired in once the
  agent-session path has been evaluated.
- **Public MCP**: the server never sees the user's message, so it cannot
  route. `ListSkills` gains the description, which gives MCP clients option (a)
  on their own.

### Observability

Add an `agent.skill_selection` span, a sibling of the docs-selection span,
with these fields:

- `candidates`
- `loaded` (skill ids)
- `suggested` (skill ids)
- `top_score`
- `bytes`
- `selection_status` (`selected`, `skipped_explicit`, `timeout`,
  `provider_error`, `unconfigured`)

Record skill ids, never skill names or the request text. Jev's `jev.decide`
child span carries latency and usage, and the turn's `invoke_agent` span
records the loaded ids, so it is possible to search for "turns where skill X
loaded".

## Tests and evaluation

- Domain tests with a fake `Cognition`:
  - An irrelevant request loads nothing.
  - A matching request loads that one skill.
  - An explicit mention skips routing.
  - A timeout loads nothing and keeps the catalog.
  - A skill the user cannot read is never a candidate.
  - The 32-question split and the budget are respected.
- Evaluation: a dozen real prompts against a seeded set of about 15 skills,
  with relevant, near-miss and irrelevant requests. Run them through the real
  Jev and record precision and recall at 0.5, 0.7 and 0.8 before fixing the
  threshold.

## Implementation PRs

1. `description` on skills: migration, API, SDK, tool and UI. Ships on its
   own.
2. `select_skills` in the `skills` domain, with tests, and the span.
3. Wiring into `agent_inmem` behind the `auto-skills` flag, the catalog in
   `rest`, and the prompt section text in `crates/prompt/src/skills.rs`.
4. The evaluation, the threshold, and docs: `skills.mdx`, the agent guide,
   and the `AGENTS.md` files.

## Open questions

- How many skills a real user has. The code assumes tens (the cap of 100 in
  `ListSkills`). If many users have hundreds, the shortlist in step 2 needs a
  pre-filter, such as name search over the message, before Jev.
- Whether to keep a loaded skill across turns instead of routing again each
  turn. This proposal routes each turn and passes the previous message to Jev.
