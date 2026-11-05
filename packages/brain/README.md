# @macro-inc/brain

The brain of an agent teammate: a long-running TypeScript program on Deno,
shipped as a versioned composition library and a thin supervisor, that listens to Macro as the agent,
decides what is for it, and runs Claude turns in the agent's workspace repo.
Design: [`docs/design/agent-brains.md`](../../docs/design/agent-brains.md).
Reference implementation: `macro-inc/tod`.

## Run it

```sh
# The image ships the brain CLI, Deno and an offline library cache.
MACRO_API_KEY=mak_... MACRO_GATEWAY=https://dev-gateway.macro.com \
BRAIN_WORKSPACE=/home/ada/workspace BRAIN_HEALTH_PORT=7801 \
ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... \
  brain run
brain health                     # what macrod polls, as JSON; exit 1 unless ok
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
| `mod.ts` | Stable public library API, documented for agents in `template/docs/brain-api.md`. |
| `brain.ts`, `main.ts` | Default composition and the `brain` CLI. |
| `supervisor.ts`, `host.ts` | Checked main-only activation, permissioned child, draining and last-known-good recovery. |
| `runtime.ts`, `dry-run.ts` | Scoped live adapters and fake-event boot adapters. |

Turns never get the Macro key. They call the `brain` binary (`post`, `reply`,
`context`, `handoff`, `remember`, `recall`, `forget`, `focus`, `promise`,
`release`, `schedule`, `schedules`, `unschedule`, `secret`), which reaches the
running brain over its control endpoint with the per-start token in
`BRAIN_CONTROL_TOKEN`. So memory writes stay on the single writer, a post stops
that turn's typing, and secrets come from `GET {auth}/team_agents/me/secrets/{name}`
per use and are never written to disk.

## The workspace

The repo server (`crates/agent_git`) embeds `template/` to seed a new repo: `OPERATING.md`
(charter, behaviour and voice, with `{{name}}`, `{{job_description}}`,
`{{personality}}` and `{{creator}}` for the server to fill), `prompts/`,
`config/{jev,events,budget}.json`, `memory/self.json`, exact-version `brain.lock`, agent-owned `brain.ts`,
`docs/brain-api.md` and
the server's `template/gitignore`. `{{creator}}` is the creating admin's Macro
user ID, so rule changes can be checked against message sender IDs.
`history/`, `log/`, `cache/` (lanes, spend ledger, heartbeat
state, Claude's config) and `work/` stay on the computer.

## Develop

```sh
deno task test      # no network: fetch, the runner and Routines/Tasks are injected
deno task check
```

## Computer image

`nix build .#macro-brain` ships the thin runner, Deno, versioned library/SDK
source and hash-pinned frozen dependencies. Both image formats include the CLI
at `/opt/macro/brain`. No compilation or library downloads happen at runtime.
See [`nix/macro-box/AGENTS.md`](../../nix/macro-box/AGENTS.md) for dependency hashes
and the service contract.

The workspace owns composition in `brain.ts` and `brain/*.ts`; imports resolve
only to the exact installed version in `brain.lock`. Run `brain check` in a work
branch before merging to main: typecheck, own tests, fake-event boot. The runner
rechecks a committed main snapshot, drains existing turns, activates and requires
continuous healthy probation (`BRAIN_HEALTH_MINUTES`, default five) before saving
`cache/wiring/last-good`. Failure restores wiring and records memory plus a
`cache/rewiring-notice` added to subsequent turn instructions. Remove that notice
after reading it. Ordinary memory/prompt commits do not reload wiring.

Direct Deno capabilities restrict read/write to workspace and `/tmp`, net to the
gateway, Anthropic proxy and local control port, and run to git/claude. The child
receives a cleared environment; scoped credentials enter the library bootstrap
through stdin and stay in adapter closures. Permitted subprocesses retain their
OS capabilities; persona identity and systemd hardening are the outer boundary.

Enrollment creates the persona's OS user and writes
`/etc/macro/personas/<os_user>.env`. The image's `brain@` template drop-in also
applies to enrollment's concrete units: it enforces hardening and runs
`start-brain`, which clones `MACRO_REPO_URL` to `BRAIN_WORKSPACE` on first
start. `BRAIN_WORKSPACE` must be `$HOME/workspace`. Git's name is the persona's
OS username; its email is the email part of `MACRO_AGENT_USER_ID` (`macro|email`).
`/health` exposes `lastTurnAt`, the most recent completed respond, heartbeat
or work turn (null until this process completes one). macrod retains that
observation while a brain is temporarily unavailable.
The credential helper supplies `MACRO_REPO_TOKEN` from the git process's
environment only for the exact repo URL. The brain passes these two repo
variables to git; Claude turns receive neither. Git config stores the helper
path, identity and repo URL, never the token. Failed clones clean up their
temporary directory, and subsequent starts keep the existing workspace.

## Telemetry

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the full OTLP HTTP traces URL
(for example, a guest-reachable collector origin plus `/v1/traces`) in the
persona's `/etc/macro/personas/<os_user>.env`, then restart its brain unit.
An unset endpoint disables telemetry with one startup log; an empty or malformed
endpoint or provisioning parent fails startup. Collector failures log a fixed
`telemetry: export_failed` diagnostic without provider payloads.

`brain.turn` records tier, opaque lane, model, tokens, cost and outcome;
`brain.jev.decide` records relevance, decision category and maximum score;
`brain.events.connect`/`brain.events.gap` measure reconnects and missing-stream
time. `brain.git.commit_push` covers the serialized commit and push, and
`brain.health` emits only when health changes. No span captures message text,
prompts, summaries, credentials, URLs or exception text.

Provisioning supplies `BRAIN_PROVISION_TRACEPARENT`, `MACRO_TEAM_ID` and
`MACRO_COMPUTER_ID` through the persona environment. Health joins that trace;
later turns link to it. User IDs use lowercase SHA-256 hex (matching backend
`macro_user_id::telemetry_id`), because the source ID can contain an email.
The Deno async-local context manager isolates concurrent turns. Macro HTTP and
SDK calls inject W3C context; Claude receives `ANTHROPIC_CUSTOM_HEADERS` so its
gateway calls join the turn. Tool subprocesses forward `BRAIN_TURN_TRACEPARENT`
back to the authenticated control server. Shutdown flushes the exporter.

Supervised children relay spans through stdout to the trusted supervisor, which
exports to the configured collector. This preserves trace IDs without giving
workspace code collector network permissions or collector credentials.
