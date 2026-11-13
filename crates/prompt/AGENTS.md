# prompt

## What it is

Part of the agent sessions feature. Static prompt fragments composed into
AI system prompts: one module per prompt section, each exporting a
`StaticPrompt` (or a dynamically-built `ComposedPrompt`) that chains via
`StaticPrompt::compose`.

## Start here

- `src/lib.rs`: the module list — one file per topic (`about_macro.rs`,
  `agent_identity.rs`, `mentions.rs`, `user_tools.rs`, ...).
- `src/types.rs`: `StaticPrompt` and `ComposedPrompt` — the composition
  mechanism every module uses.
- `src/coding_agents.rs`: an example pairing a `.rs` module with a sibling
  text file for the actual prompt text.

## Scope

- Owns: the wording of static, reusable prompt sections and how they compose.
- Not here: deciding which sections go into a given agent's final prompt, or
  per-turn dynamic context → `agent`, `agent_harness`.

## Boundaries

- Used by: `ai_tools`, `agent_inmem`, `channel_bots`, `agent`,
  `system_skills`, `services/agent_harness_service`,
  `services/agent_harness_service`, `services/agent_harness_service`.

## Recipes

- Add a prompt section: new `src/<topic>.rs` (+ `src/<topic>.md` if the text
  is long) exporting a `pub static PROMPT: StaticPrompt` → `pub mod` it in
  `src/lib.rs` → compose it where the caller builds its prompt.
- Guidance for one tool goes in that tool's description, and how an area of
  Macro works (databases, CRM, email, calendar, channels, tasks, routines,
  documents, search) in its SDK namespace's `@agent` TSDoc block, never here:
  `ai_tools` inlines it from the generated catalog, and routed turns load it
  per entity. Only cross-cutting rules live in this crate. `code_mode.rs` is
  only the general code-mode section (`PROMPT`, and `CHAT_PROMPT` for the
  in-app chat, which presents with `DisplayResults`).

## Tool contracts

- Direct session-aware search/listing stays available in code mode; do not route conversation work to legacy chat tools or SDK namespaces.

- Code mode reads and edits canvases through the SDK's `document.canvas()` handle, never
  `content()`, which does not represent the shared scene; only `RenderCanvas` stays direct, because
  an ExecuteCode result cannot carry an image to the model.
The agent-session prompt distinguishes typed `<m-notifications>` system facts
from user requests and defines the notification-only `<noop/>` contract.
In-app replies use `m-document-mention` with `blockName: "routine"` for routines;
external MCP replies use `/app/routines/<id>` URLs.
A form for a channel is a poll (one required select question, tally visible),
posted once as `<m-document-card>` with `blockName: "form"`; the card's message
reference grants the channel View, so no second message or link is needed.

- `src/privacy.rs` supplies generation/judge privacy policy; `compose` joins runtime memory sections without static lifetimes.

## Checks

- `cargo test -p prompt` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
