# crates/agents

## What it is

Agent sessions: sessions and their realtime fan-out, the harness that runs agents, triggers, bots and harness registrations, Codex and Cursor cloud agents, routines and scheduled actions, skills, prompts, code execution and code mode, dynamic UI, and the transcript folds (`agent_fold`, `claude_fold`, `codex_fold`). The macrod daemon (`crates/agents/macrod`) stays at the top level: its directory is part of the public install URL.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`agent_api_keys`](agent_api_keys/AGENTS.md) | Part of agents: an agent's own Anthropic or OpenAI API key. |
| [`agent_changes`](agent_changes/AGENTS.md) | Part of agent sessions: after each turn, reviews the GitHub pull request linked to a coding-agent session and captures per-file diff facts, the patch, and a summary, so … |
| [`agent_code_mode`](agent_code_mode/AGENTS.md) |  |
| [`agent_egress`](agent_egress/AGENTS.md) | Part of agent sessions: the security boundary for sandboxed coding agents. |
| [`agent_fold`](agent_fold/AGENTS.md) | Core to the agent sessions feature: collapses an agent session's raw ACP/ARP protocol log into the renderable message vocabulary every caller (harness, web, exports) … |
| [`agent_fold_wasm`](agent_fold_wasm/AGENTS.md) | The browser build of `agent_fold` (the agent transcript fold the web app runs in a worker). |
| [`agent_harness`](agent_harness/AGENTS.md) | Part of agent sessions: orchestrates sandboxed coding-agent sessions end to end — provisioning containers, speaking to each coding-agent runtime (Cursor, Codex), routing … |
| [`agent_inmem`](agent_inmem/AGENTS.md) | Part of agent sessions: the lightweight alternative to `agent_harness`'s sandboxed containers — serves the agent side of ACP in-process, running the same agentic loop … |
| [`agent_preview`](agent_preview/AGENTS.md) | Part of agent sessions: lets an agent session's dev server be viewed live by other people. |
| [`agent_runtime_protocol`](agent_runtime_protocol/AGENTS.md) | Part of agent sessions: the outer wire protocol every coding-agent transport (sandboxed containers, in-process, and the Cursor/Codex cloud-agent adapters) speaks — … |
| [`agent_session`](agent_session/AGENTS.md) | Part of agent sessions: the coding-agent session entity itself — lifecycle, control, sharing, and the Postgres/HTTP surface every agent-harness consumer talks to. |
| [`agent_session_realtime`](agent_session_realtime/AGENTS.md) | Part of agent sessions: fans out newly appended agent session log frames, from the harness' Redis Stream to whoever is subscribed over GraphQL, so an open session view … |
| [`agent_trigger`](agent_trigger/AGENTS.md) | Part of agent sessions: decides whether a posted channel message, task assignment, or project assignment should start an agent session, and assembles the prompt context … |
| [`bots`](bots/AGENTS.md) | Part of agent sessions: owns the bot entity itself — models, persistence, ownership (user or team), and HTTP/AI-tool adapters, plus lifecycle events for bot mutations … |
| `claude_fold` |  |
| [`code_execution_core`](code_execution_core/AGENTS.md) | Part of agent code mode: the domain half of bounded JavaScript execution. |
| [`code_execution_outbound`](code_execution_outbound/AGENTS.md) |  |
| [`code_mode_assets`](code_mode_assets/AGENTS.md) | Agent code mode's generated assets: the public SDK and Handlebars bundled for Deno, the agent SDK documentation catalog, the SDK operation catalog (label, method, path … |
| [`codex_cloud_agents`](codex_cloud_agents/AGENTS.md) | Part of agent sessions: Codex cloud transport and ACP conversations — OAuth/credentials, the OpenAI cloud-task HTTP client, and the ACP adapter used by both the … |
| [`codex_connection`](codex_connection/AGENTS.md) | Part of agent sessions: owner-bound Codex OAuth connections — durable device login and encrypted credential storage/rotation for hosted Codex sessions. |
| `codex_fold` |  |
| [`cursor_api_key`](cursor_api_key/AGENTS.md) | Part of agent sessions: a user's Cursor API key — KMS encryption (`cipher`) and row storage (`store`) for the per-user secret `@cursor` sessions run on. |
| [`cursor_cloud_agents`](cursor_cloud_agents/AGENTS.md) | Part of agent sessions: an ACP agent backed by Cursor cloud agents — one ACP session is one Cursor *agent*, one `session/prompt` is one Cursor *run*, and the run's SSE … |
| [`dynamic_ui`](dynamic_ui/AGENTS.md) | The view an agent shows a person (`execution.views.present` in agent sessions, `DisplayResults` in chat), as the web's dynamic-UI renderer draws it. |
| [`harnesses`](harnesses/AGENTS.md) | Belongs to agent sessions: registration for user-run agent harnesses (macrod). |
| [`prompt`](prompt/AGENTS.md) | Part of the agent sessions feature. |
| [`routine_program`](routine_program/AGENTS.md) | Routines: the typed program a routine runs. |
| [`routines`](routines/AGENTS.md) | Part of the agent sessions feature. |
| [`scheduled_action`](scheduled_action/AGENTS.md) | Serves agent sessions' automations ("routines"): the reusable domain and adapters for scheduled and event-triggered agent automations — cron-style schedules plus … |
| [`skills`](skills/AGENTS.md) | Part of the agent sessions feature. |
| `system_skills` |  |

## Recipes

- Add a crate here: create `crates/agents/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.

## Folds

`agent_fold`, `claude_fold` and `codex_fold` are pure, deterministic folds
that turn agent transcripts into Macro messages. Keep filesystem tailing, process control, transport,
credentials and session ownership in their adapters.

- `claude_fold`: Claude Code JSONL to ACP updates and turn facts.
- `codex_fold`: Codex rollout JSONL to ACP updates and turn facts.
- `agent_fold`: ACP protocol frames to Macro messages and lifecycle events;
  also built to wasm for the web app.

Native folds implement `agent_fold::domain::transcript::Fold`. Their fixtures
are synthetic transcripts with pinned output snapshots, plus sanitized
excerpts of real transcripts for regressions. Runtime adapters consume the
same events; there is no separate parsing implementation in macrod.
