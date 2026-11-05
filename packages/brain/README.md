# @macro-inc/brain

The brain of an agent teammate: a long-running TypeScript program on Deno,
shipped as one `deno compile` binary, that listens to Macro as the agent,
decides what is for it, and runs Claude turns in the agent's workspace repo.
Design: [`docs/design/agent-brains.md`](../../docs/design/agent-brains.md).
Reference implementation: `macro-inc/tod`.

## Run it

```sh
deno task compile                     # dist/brain
MACRO_API_KEY=mak_... MACRO_GATEWAY=https://dev-gateway.macro.com \
BRAIN_WORKSPACE=/home/ada/workspace BRAIN_HEALTH_PORT=7801 \
ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... \
  dist/brain run
dist/brain health                     # what macrod polls, as JSON; exit 1 unless ok
```

Every variable is required; a missing one fails startup with its name. Claude
access comes only from `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (Macro's
gateway); turns run with `CLAUDE_CONFIG_DIR=<workspace>/cache/claude`, so a
personal `~/.claude` login is never read. `claude` must be on `PATH`, and the
workspace must be a clone of the agent's repo with git identity and push
credentials configured.

## How it works

```
event stream ─▶ history/ ─▶ work running here? ─▶ inject into it
                                   │ no
                                   ▼
                        Jev (mentions, DMs skip) ─▶ lane per conversation ─▶ respond turn
heartbeat timer / schedule wake-up ─────────────────────────────────────────▶ heartbeat turn
respond turn `brain handoff` ─▶ Macro task + work/<task>/ worktree ───────────▶ work turn ─▶ report
every turn ─▶ commit `turn <id>: <summary>` ─▶ pull --rebase ─▶ push
```

| Module | Does |
| --- | --- |
| `workspace.ts` | Persona files, `.gitignore` enforcement, the single-writer commit + push queue. |
| `events.ts` | SSE on `{dss}/webhook/events/stream`, idle watchdog, doubling reconnect, catch-up since the drop. |
| `jev.ts` | `config/jev.json` (Tod's format plus `wakeIf`), the decide call with fallbacks, `log/decisions.jsonl`. |
| `lanes.ts` | Durable JSONL queue per conversation; bursts batch, crashes replay, failures go to `failed/`. |
| `pool.ts` | Per-tier concurrency, one speaking turn at a time, per-run and per-day spend caps. |
| `runner.ts` | `start(turn) → { events, inject, abort, done }` over the Claude Agent SDK with streaming input. |
| `work.ts` | Hand-offs: a Macro task, a git worktree, follow-ups injected, the final message posted as the report. |
| `schedules.ts` | Macro routines the agent creates for itself; their runs arrive as `agent_session.opened`. |
| `memory.ts` | `memory/notes/<topic>.md` and `memory/self.json` (focus, commitments, last things said). |
| `control.ts` | `127.0.0.1:$BRAIN_HEALTH_PORT`: `/health` for macrod, token-guarded routes for turns. |
| `presence.ts` | Online (pinged connection-gateway websocket) and typing. |
| `brain.ts`, `main.ts` | Wiring and the `brain` CLI. |

Turns never get the Macro key. They call the `brain` binary (`post`, `reply`,
`context`, `handoff`, `remember`, `recall`, `forget`, `focus`, `promise`,
`release`, `schedule`, `schedules`, `unschedule`, `secret`), which reaches the
running brain over its control endpoint with the per-start token in
`BRAIN_CONTROL_TOKEN`. So memory writes stay on the single writer, a post stops
that turn's typing, and secrets come from `GET {auth}/team_agents/me/secrets/{name}`
per use and are never written to disk.

## The workspace

`template/` is what the server seeds a new agent repo with: `OPERATING.md`
(charter, behaviour and voice, with `{{name}}`, `{{job_description}}`,
`{{personality}}` and `{{creator}}` for the server to fill), `prompts/`,
`config/{jev,events,budget}.json`, `memory/self.json`, `brain.lock` and
`.gitignore`. `history/`, `log/`, `cache/` (lanes, spend ledger, heartbeat
state, Claude's config) and `work/` stay on the computer.

## Develop

```sh
deno task test      # no network: fetch, the runner and Routines/Tasks are injected
deno task check
deno task compile
```
