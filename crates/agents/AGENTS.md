# crates/agents

## What it is

Agent sessions: sessions and their realtime fan-out, the harness that runs agents, triggers, bots and harness registrations, Codex and Cursor cloud agents, routines and scheduled actions, skills, prompts, code execution and code mode, dynamic UI, and the transcript folds (`agent_fold`, `claude_fold`, `codex_fold`). The macrod daemon (`crates/coding_agent_worker`) stays at the top level: its directory is part of the public install URL.

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`agent_api_keys`](agent_api_keys/AGENTS.md) | Part of agents: an agent's own Anthropic or OpenAI API key. |
| [`agent_changes`](agent_changes/AGENTS.md) | Part of agent sessions: after each turn, reviews the GitHub pull request linked to a coding-agent session and captures per-file diff facts, the patch, and a summary, so … |
| [`agent_code_mode`](agent_code_mode/AGENTS.md) |  |
| [`agent_credentials`](agent_credentials/AGENTS.md) | Validated bootstrap credentials shared by agent git, team-agent provisioning and the standalone brain gateway, and the agent teammates rollout for agent accounts. |
| [`agent_egress`](agent_egress/AGENTS.md) | Part of agent sessions: the security boundary for sandboxed coding agents. |
| [`agent_fold`](agent_fold/AGENTS.md) | Core to the agent sessions feature: collapses an agent session's raw ACP/ARP protocol log into the renderable message vocabulary every caller (harness, web, exports) … |
| [`agent_git`](agent_git/AGENTS.md) | Agent teammates (`docs/design/agent-teammates.md`, "The repo"): exactly one bare git repo per agent user, served over smart HTTP behind Macro auth, plus the internal … |
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
| [`harnessd`](harnessd/AGENTS.md) | The agent sign-in daemon baked into the Macro computer image (computers). |
| [`harnessd_protocol`](harnessd_protocol/AGENTS.md) | The wire types of `harnessd`, the agent sign-in daemon on a Macro computer: JSON lines the control plane writes to `harnessd` over `Fleet::exec`, and the lines it … |
| [`harnesses`](harnesses/AGENTS.md) | Belongs to agent sessions: registration for user-run agent harnesses (macrod), called machines in the product. |
| [`hosted_runtimes`](hosted_runtimes/AGENTS.md) | Macro computers: hosted VMs a team buys, each running macrod so it shows up in Settings → Runtimes like a paired machine. |
| [`prompt`](prompt/AGENTS.md) | Part of the agent sessions feature. |
| [`routine_program`](routine_program/AGENTS.md) | Routines: the typed program a routine runs. |
| [`routines`](routines/AGENTS.md) | Part of the agent sessions feature. |
| [`scheduled_action`](scheduled_action/AGENTS.md) | Serves agent sessions' automations ("routines"): the reusable domain and adapters for scheduled and event-triggered agent automations — cron-style schedules plus … |
| [`skills`](skills/AGENTS.md) | Part of the agent sessions feature. |
| [`suggestion_generation`](suggestion_generation/AGENTS.md) | Generations for Suggestions and routine suggestions: runs of hidden agent sessions, at onboarding, in each person's night and when they ask for fresh suggestions, that … |
| [`suggestions`](suggestions/AGENTS.md) | Suggestions: each person's feed of proactive suggestions (a prompt to run, a note about specific items, or a routine suggestion), written and managed by hidden … |
| [`suggestions_db_utils`](suggestions_db_utils/AGENTS.md) | Transactional helpers for the `suggestion` tables, for writes that commit with another crate's: routine suggestions (`crates/agents/scheduled_action`) keep, dismiss, retire and … |
| [`system_skills`](system_skills/AGENTS.md) | Agent skills: Macro's built-in skills, available to every user. |
| [`team_agents`](team_agents/AGENTS.md) | Agent teammates: AI members of a team, each a real Macro account with its own Macro computer and workspace repository, behind the `enable-agent-teammates` PostHog flag. |

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
