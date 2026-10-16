# prompt

## What it is

Part of the agent sessions feature. Static prompt fragments composed into
AI system prompts: one module per prompt section, each exporting a
`StaticPrompt` (or a dynamically-built `ComposedPrompt`) that chains via
`StaticPrompt::compose`.

## Start here

- `src/lib.rs`: the module list — one file per topic (`about_macro.rs`,
  `agent_identity.rs`, `mentions.rs`, `databases.rs`, `crm_pipelines.rs`, ...).
- `src/types.rs`: `StaticPrompt` and `ComposedPrompt` — the composition
  mechanism every module uses.
- `src/databases.rs` / `src/crm_pipelines.rs`: examples pairing a `.rs` module
  with a sibling `.md` file for the actual prompt text.

## Scope

- Owns: the wording of static, reusable prompt sections and how they compose.
- Not here: deciding which sections go into a given agent's final prompt, or
  per-turn dynamic context → `agent`, `agent_harness`.

## Boundaries

- Used by: `ai_tools`, `agent_inmem`, `channel_bots`, `agent`,
  `system_skills`, `services/document_cognition_service`,
  `services/mcp_service`, `services/agent_harness_service`.

## Recipes

- Add a prompt section: new `src/<topic>.rs` (+ `src/<topic>.md` if the text
  is long) exporting a `pub static PROMPT: StaticPrompt` → `pub mod` it in
  `src/lib.rs` → compose it where the caller builds its prompt.

## Checks

- `cargo test -p prompt` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
