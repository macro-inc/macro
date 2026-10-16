# agent_setup

## What it is

Agent-led setup over MCP: the six Setup tools a person's own AI agent
(Claude, ChatGPT, Codex) uses to set up their Macro workspace. They report
what's set up, hand out connect links, show what Macro found, agree one plan,
import it and report back. Served only while `ENABLE_AGENT_SETUP` is on in
`mcp_service`.

## How it works

`SetupGetState` → `SetupConnect` (one `/app/connect/:app` link per tool) →
`SetupDiscover` → `SetupProposePlan` (one approval) → `SetupImport` →
`SetupGetStatus`. Every result carries one `next_step` the agent follows. Each
step wraps an existing service; the import service still does all copying.

## Start here

- `src/domain/service.rs`: the six steps and `next_step` wording.
- `src/domain/catalog.rs`: how each tool is handled (import, import later,
  keep connected, inbox); importability comes from `ImportSource`.
- `src/domain/plan.rs`: the plan text the person approves.
- `src/inbound/toolset.rs`: tool schemas and annotations.

## Scope

- Owns: sequencing setup and what the agent is told at each step.
- Not here: what a gather finds or how items are copied → `crates/import`;
  connections → `crates/pipedream_mcp`; the sign-in hook, setup hint and
  composition → `services/mcp_service`.

## Boundaries

- Depends on: `import` (models and service), `pipedream_mcp`, `mcp_select`,
  through the ports in `src/domain/ports.rs`.
- Used by: `ai_tools` (`mcp_tools_with_agent_setup`), `services/mcp_service`.

## Checks

- `cargo test -p agent_setup`
- Agent behaviour: `cargo run -p mcp_service --example setup_sim -- --port 8788`
  serves these tools against simulated Macro services for scripted agent runs.

## Gotchas

- The import port can't discard and starts gathers with automatic import off:
  imported content can carry prompt injections, so no Setup tool may decline
  items permanently or import anything the person didn't approve.
- Only `SetupConnect` and `SetupImport` write. Keep the rest read-only so
  clients that confirm writes ask the person at most twice.
- Results never carry document content; candidates are titles and short refs.
