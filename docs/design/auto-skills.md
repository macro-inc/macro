# Automatic skills

Status: proposal. Nothing here is built yet.

## Goal

1. **Agents load skills automatically.** An agent should follow a skill
   whenever a request needs it, without the user attaching it with `/`. For
   example, "draft the release notes" should use the user's "Release notes"
   skill. A request that no skill covers should load nothing.
2. **Core areas become built-in skills.** Routines, databases, CRM, search,
   documents, email, calendar, channels, tasks and coding each become a
   built-in skill that owns its prompt guidance and its tools. Jev loads the
   ones a request needs, and the always-on prompt keeps only cross-cutting
   rules.

## What exists

- **Skills are documents.** A skill is a markdown document whose sub type is
  `skill`. Its only metadata is its name: there is no description and no
  trigger (`crates/skills/src/domain/model.rs`). Visibility follows ordinary
  document access.
- **System skills are code.** They are defined in `crates/system_skills` as
  `SystemSkill { slug, name, content }`, with a UUIDv5 id. There are three:
  `catch-me-up`, `what-i-did-yesterday` and `configure-agent`. All are shown
  to users in the `/` menu.
- **Skill tools.**
  - `ListSkills` returns at most 100 skills, as id and name.
  - `SearchSkills` matches names only.
  - `ReadSkill` returns the body after an access check.
  - All three are eager, direct tools, including in code mode.
- **Nothing finds a skill automatically.** Unless the user attaches a skill,
  the model has to decide on its own to search for one by name.
- **Jev** (`crates/jev`) is a cheap yes/no classifier: at most 32 questions per
  call, no prompt cache, $0.042 per million input tokens. Agent sessions
  already call it before each turn for SDK docs selection
  (`select_documentation`):
  - one question per SDK entity, built from its `catalog.ts` one-liner;
  - a 1 s deadline, run alongside the memory fetch;
  - entities scoring 0.5 or higher are kept, at most 4;
  - the result goes in the turn part of the prompt.
- **Prompt layout** (`agent::SystemPrompt`):
  - `shared` is identical for every session and is the Anthropic cache
    breakpoint;
  - `rest` is per session;
  - `turn` comes last.
- **Area guidance is scattered** across prompt sections, tool descriptions,
  SDK TSDoc and code-mode topic guides (`crates/agent_code_mode/.../guides`).
  Tools are eager (27, mostly core search, read and edit) or deferred, and
  the deferred ones are listed one line each in the prompt.

Sizes below are rendered characters on `main` after #9396 (`ca2a06a297`).
Excluding the deferred-tool catalog, the tool prompt is:

| Host | Characters |
| --- | --- |
| Chat | 26,896 |
| Agent session | 28,408 |
| Agent session, code mode | 29,489 |
| Channel bot and MCP toolset | 24,192 |

## Prior art

- **Agent Skills** (Claude Code, the Claude API): `name` and `description`
  ("what it does and when to use it") are always in context. The model loads
  the body with a tool call.
- **Cursor rules**: "Agent Requested" rules work by description. "Auto
  Attached" rules are routed by file glob before the turn.
- **Macro's deferred tools**: a catalog in the prompt, with each schema
  loaded on demand.

## Built-in skills

Each built-in is a code-defined system skill with these fields:

- `description`: one "Use when …" sentence that also says what the skill is
  not for, because this is what Jev routes on.
- `instructions`: the area's domain rules, moved out of `crates/prompt`.
- `tools`: the deferred tools the skill owns.
- `sdk_entities`: the SDK entities the skill covers.

Loading a skill brings all of it into the turn: its instructions, its tools,
and, in code mode, its entities' indexes. **Loading one of its tools loads the
skill too**, so a model that reaches for `QueryDatabase` without the skill
still gets the database rules. The table lists each candidate; "Tools" are
deferred unless noted.

| Skill | Use when … | Moves in from `crates/prompt` (chars) | Tools | SDK |
| --- | --- | --- | --- | --- |
| `finding-things` | the user asks to find, look up or list their own Macro content (documents, emails, messages, tasks, people), or asks something their workspace answers; not for the web | code-mode `guides/search.md` (1,427) becomes its body | ContentSearch, NameSearch, ListEntities, ReadContent, ReadMetadata (eager, they stay eager), ReadActivity | search, entity |
| `documents` | creating, writing into or editing a document, canvas, spreadsheet, Word document or deck; not databases | `document_content_links` (3,339) | CreateDocument, EditDocument (eager); canvas, spreadsheet, Word, PowerPoint, design readers, RenameDocument, CommentOnText, UploadFile, GenerateImage | documents |
| `databases` | working with a Macro database or table: creating one, querying it, adding rows, columns or views; not CRM pipelines or spreadsheets | `databases` (2,766) | ListDatabases, DescribeDatabase, QueryDatabase, SaveDatabaseQuery, Save/DeleteDatabaseView | databases |
| `crm` | deals, pipelines, stages, companies or contacts; not generic databases | `crm_pipelines` (749) | the 14 pipeline, company and contact tools | crm |
| `routines` | something should happen later, on a schedule, or whenever an event occurs ("every Monday", "remind me", "when an email arrives") | new body: the general rules in CreateRoutine's description (agent target, once vs cron, never create a routine per run) | Create/List/Read/Update/Run/DeleteRoutine | routines |
| `email` | reading, searching, labelling, drafting or sending email, or working across inboxes | `email` (2,024) plus the email half of `user_tools` | ListInboxes, ListLabels, UpdateThreadLabels, SetSenderPolicy, SendEmail, SendConfirmedEmail; GetThread (eager) | email |
| `calendar` | events, availability, scheduling a meeting or booking links | `user_tools::BOOKING` (1,324) plus the event half of `user_tools` | the 9 calendar-event and 9 booking tools | calendar, meetings |
| `channels` | posting, reacting, polls or managing members in a channel or direct message; not reading a thread that is already in context | the polls subsection of `mentions` (960) | Create/Rename/ManageParticipants, Edit/Delete/ReactTo message, OpenDirectMessage; reading and sending stay eager | channels, messages |
| `tasks` | creating, assigning or updating tasks or initiatives | `tasks` (791) | properties tools | tasks, initiatives |
| `coding` | changing code, a repository, a pull request or a coding agent | `coding_agents` (1,560), `pull_requests` | DispatchCodingAgent, ListCodingAgents, CreateAgentSession, ManageAgentSession | agent-sessions, harnesses |
| `configure-agent` (exists) | changing an agent's or bot's instructions or settings | none | ListAgents, ConfigureAgent, the bot tools | agents, bots |

**Shared fragments.** The rules in `user_tools` cover both `SendEmail` and
`CreateCalendarEvent`: review card versus thread, and the confirmed twins.
They become one fragment composed into both `email` and `calendar`, so the
text exists in one place.

**What stays always-on:**

| Section | Characters | Notes |
| --- | --- | --- |
| `tone` (`agent_session` in sessions) | | |
| `math` | | |
| `citations` | | |
| `mentions` | 7.4k | Every reply may mention items |
| `do_not` | | |
| `about_macro` | | Terms |
| `code_mode` | | Code mode only |
| `skills` | | Rewritten to explain built-ins and catalog |
| Built-in catalog | about 1.5k | New, see below |

**Per-host prompt size**, before and after, excluding the deferred catalog.
The after column subtracts the moved sections and adds about 1.8k for the
built-in catalog and the skills rule.

| Host | Before | After | Change |
| --- | --- | --- | --- |
| Chat | 26,896 | about 14,600 | −46% |
| Agent session | 28,408 | about 14,050 | −51% |
| Agent session, code mode | 29,489 | about 15,550 | −47% |
| Channel bot and MCP toolset | 24,192 | about 14,600 | −40% |

The deferred catalog shrinks as well: tools a skill owns leave it and appear
under their skill. That saving is not measured yet; PR 4 measures it.

A turn that loads skills pays for their bodies: 1–4k characters each, usually
zero to two skills. A turn that needs none (chit-chat, a follow-up, a plain
answer) pays nothing. **A skill that loads on most turns belongs in the
always-on prompt instead.** `finding-things` is the likeliest case, and the
traffic sample in the evaluation decides it.

## Hidden skills (interpretation)

Wolf asked to "make skills hidden a column". Read here as: built-in skills
are loaded by agents but do not clutter users' Drive, `/` menu or skill
lists.

**Recommended: built-ins stay in code, with a flag on `SystemSkill`.**

- The flag is `visibility: Listed | AgentOnly`. The three existing skills are
  `Listed`; the new area skills are `AgentOnly`.
- `AgentOnly` skills are routed, appear in the model's catalog and
  `ListSkills`, and are readable with `ReadSkill`, including by MCP clients.
- `GET /documents/system_skills`, which feeds the `/` menu and
  `systemSkills()`, omits them.
- Being in code means they are versioned with the tools they describe,
  reviewed in pull requests, identical across environments, needing no
  seeding, and cache-friendly.

**Not recommended: a `hidden` column on skill documents.**

- A built-in stored as a document has to be shared with every user to be
  readable.
- Once shared, it shows up everywhere, so the flag would have to be filtered
  in the soup document clause and its candidate, by-id and cursor queries,
  the work feed, GraphQL soup, `ListEntities`, the quick-access `skill` query
  behind the `/` menu, Drive (which follows soup), search indexing
  (`raw_document.rs` indexes `sub_type`), and the `ListSkills` lister.
- There is no existing hidden-document mechanism to reuse.

A column becomes worth adding only if users or teams need to write their own
agent-only skills. If they do, store it with the description (below) and
filter it in soup's sub-type clause and the search indexer.

## Skills and SDK guidance in code mode

One source per topic:

| What | Where it lives |
| --- | --- |
| When and why to use an area, plus its domain rules (column types, a pipeline is not a database, once versus cron) | The built-in skill, shared by direct and code mode |
| How to call one direct tool | That tool's description |
| How to call the SDK (signatures, options, short usage notes) | TSDoc, generated into the entity index and `ReadCodeDocs` |

**Consequences:**

- **Skill descriptions are the routing questions.** For an entity a skill
  covers, the skill's description replaces the `catalog.ts` one-liner as the
  Jev question.
- **One router.** The router picks skills, and a loaded skill brings its
  entities' indexes. `select_documentation`'s separate Jev pass goes away
  once every entity is covered; until then, uncovered entities stay in the
  catalog and `DescribeCodeTools`.
- **No separate "entity guide" in TSDoc for agents.** The skill is the entity
  guide. TSDoc keeps the "how to call" text #9396 added to namespace classes,
  which also serves external SDK users.
- **Topic guides move into skills.** `DescribeCodeTools` topics that are really
  area guides become skill bodies; `search` becomes `finding-things`.
  `DescribeCodeTools({topics: ["search"]})` returns the skill body, so the
  text exists once.

## Loading

The hybrid still holds, with three changes now that most guidance lives in
skills.

1. **Candidates.** The built-ins (about 11, fixed) plus every skill the user
   can read, most recently updated first. They are split into
   `ceil(candidates / 32)` parallel Jev calls, capped at 8 calls (256
   candidates). Skills past the cap are not routed but stay reachable through
   the catalog and `ReadSkill`. Skills already loaded in this session, and
   skills the message explicitly mentions, are skipped.
2. **Route.** Jev gets the last user message plus the previous one, and one
   independent question per candidate, so several skills can match. "Every
   Monday, summarise new rows in Leads" loads both `routines` and
   `databases`. Thresholds:
   - Built-ins: 0.7, at most 3. They are reviewed text, and missing one
     costs domain rules. On the evaluation, 0.7 kept the recall of 0.5 (90%)
     and loaded the exact expected set almost twice as often.
   - User skills: 0.8, at most 2. They redirect behaviour, so a false
     positive costs more.
   - The evaluation calibrates both.
3. **Discriminating descriptions.** Each built-in description says what it is
   not for (databases: "not CRM pipelines or spreadsheets"). The evaluation
   reports the confusable pairs: databases/crm, databases/documents,
   finding-things/email, routines/calendar.
4. **Load, sticky.** Loaded skills' bodies go in the turn part of the system
   prompt, skills first and SDK references after them. Each session keeps
   the skills it has loaded (at most 8, oldest dropped first) in the engine's
   memory, so a skill stays in effect without being routed again, and the
   turn part changes only when a new skill loads. After a restart, a session
   routes again from its next message. Persisting loaded skills in the
   session log would survive restarts too, but would need a new frame kind;
   that waits until restarts prove to matter.
5. **Catalog.**
   - Built-in names, ids and descriptions go in `shared` (the routed prompt).
     They are identical for everyone, so they are cached.
   - User skills are not listed in the prompt: `ListSkills` and
     `SearchSkills` stay eager tools, and listing hundreds of skills every
     turn would cost more than it saves.
   - User skills that score between 0.5 and the load threshold are recorded
     on the span as `suggested`, not put in the prompt, where they would
     change every turn and break the cache.
   - The model can read anything Jev missed with `ReadSkill`.
6. **Tools.** A skill's body names the deferred tools it covers, and the
   model loads them with `LoadTools`, as it does today. Jev cannot preload
   them: on Anthropic, a deferred tool is only callable once a tool result
   references it, so a preload would need a fake call. The backstop (loading
   one of a skill's tools loads the skill) follows as its own change.
   `CreateDocument` and `EditDocument` stay eager, so `documents` would have
   no backstop anyway: if the evaluation shows its recall below 95%,
   `document_content_links` stays always-on.
7. **Failure.** On a timeout, a Jev error, or no cognition service, nothing
   loads and the catalog stays. The turn never waits longer than the 1 s
   deadline.

**Hosts:**

- **Agent sessions:** first, direct and code mode, behind the `auto-skills`
  flag. Without the flag, and on every host that does not route, the prompt
  carries every agent-only skill's instructions inline, so moving guidance
  into skills changes nothing for them.
- **Chat and channel bot:** next.
- **Public MCP:** never sees the user's message, so it cannot route. Its
  instructions shrink in the same way, pointing at `ListSkills` (now with
  descriptions) and `ReadSkill`.

## Metadata

**User skills** get a `description`:

- required for new skills, at most 300 characters, written as "Use when …";
- stored in a `skill` table keyed by `document_id`, not in front matter,
  because the router reads every candidate on every turn and reading each
  body through lexical is too slow;
- set through `create_skill`, `CreateSkill`, `DocumentNamespace.createSkill`
  and ComposeSkill, and editable afterwards;
- an existing skill without one is routed by name, and the UI asks for one.

**Built-ins** carry `description`, `visibility`, `tools` and `sdk_entities`
in code.

## Observability

Add an `agent.skill_selection` span, a sibling of the docs-selection span,
with these fields:

- `candidates`
- `loaded_builtin` (slugs)
- `loaded_user` (ids)
- `suggested` (ids)
- `top_score`
- `bytes`
- `selection_status` (`selected`, `timeout`, `provider_error`,
  `unconfigured`)

Loads the model makes itself through `ReadSkill` or the tool backstop record
`skill.loaded` with `source=model|tool`. That makes it possible to count
router misses and loads per turn, which drive the always-on decision. Record
slugs and ids, never user skill names or request text.

## Evaluation

The prompts below are written for this document, modelled on common request
shapes. Real user prompts never go in the repository. A private run samples
recent agent-session prompts outside it, to measure how often each skill
loads.

| # | Prompt | Expected |
| --- | --- | --- |
| 1 | What did the design team decide about the Q3 launch? | finding-things |
| 2 | Find the contract we sent Acme last month | finding-things |
| 3 | Every Monday at 9, send me a summary of my open tasks | routines, tasks |
| 4 | Remind me tomorrow at 3pm to call the bank | routines |
| 5 | Add a Status column to the Hiring table and mark the first three rows done | databases |
| 6 | How many rows in Leads have revenue over 10k? | databases |
| 7 | Move Acme to Negotiation | crm |
| 8 | Which deals in the pipeline are owned by Sam? | crm |
| 9 | Draft a reply to the latest email from our landlord | email |
| 10 | Label every newsletter in my work inbox as Later | email |
| 11 | Find 30 minutes next week with Priya and Leo | calendar |
| 12 | Send me my booking link | calendar |
| 13 | Write a project brief for the onboarding revamp | documents |
| 14 | Fix the formulas in the budget spreadsheet | documents |
| 15 | Post a poll in #design about the two logo options | channels |
| 16 | Create a task for Sam to review the deck by Friday | tasks |
| 17 | Fix the flaky login test and open a PR | coding |
| 18 | Make my agent always answer in French | configure-agent |
| 19 | When a new row is added to Leads, email me | routines, databases |
| 20 | Thanks, that's perfect! | none |
| 21 | What's 15% of 2,340? | none |

**Targets:**

- No skill loads on irrelevant prompts (#20, #21) in at least 95% of runs.
- Built-in recall is at least 90%.
- The exact expected set loads in at least 80% of runs.

Run each prompt five times against the real Jev, and report precision and
recall per skill at thresholds 0.5, 0.7 and 0.8.

## Tests

Domain tests with a fake `Cognition`:

- An irrelevant request loads nothing.
- A matching request loads exactly that skill.
- Two independent matches load both.
- An explicit mention skips routing.
- An already-loaded skill is not routed again.
- A timeout loads nothing and keeps the catalog.
- An unreadable user skill is never a candidate.
- An `AgentOnly` skill is absent from `/documents/system_skills`.
- Loading a skill's tool loads the skill.
- Candidates split into `ceil(n / 32)` calls, at most 8; the 257th candidate
  is not routed.
- The size budgets hold.

## Implementation PRs

1. **Metadata.** `SystemSkill` gains `description`, `visibility`, `tools` and
   `sdk_entities`. User skills get a description (migration, API, SDK, tool,
   UI).
2. **Router.** `select_skills` in the `skills` domain, with tests and the
   span.
3. **Loading in agent sessions,** behind the `auto-skills` flag: sticky
   loading, tool loading, the tool backstop, and the catalog.
4. **Move areas into built-ins**, one area per PR, until `crates/prompt`
   holds no area guidance (`databases.md`, `crm_pipelines.md`, `email`,
   `user_tools`, `tasks`, `document_content_links`, `coding_agents`, the polls
   rules). Each PR reports the prompt size before and after and the
   evaluation hit rate.
5. **Skill-driven entity loading.** Loaded skills bring their SDK entity
   indexes, and `select_documentation` is removed.
6. **Docs:** `skills.mdx`, the agent guide and the `AGENTS.md` files, in each
   PR they affect.

## Open questions

- Whether `finding-things` loads so often that it belongs in the always-on
  prompt. The traffic sample decides.
- Whether providers other than Anthropic tolerate tools added mid-session
  without losing their cache. If they don't, those providers get the
  instructions only, and the model loads the tools with `LoadTools`.
