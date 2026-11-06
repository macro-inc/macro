# @macro-inc/brain

The brain of an agent teammate: a long-running TypeScript program on Node 24,
shipped as a versioned composition library and a thin supervisor, that listens to Macro as the agent,
decides what is for it, and runs Claude turns in the agent's workspace repo.
Design: [`docs/design/agent-brains.md`](../../docs/design/agent-brains.md).
Reference implementation: `macro-inc/tod`.

## Run it

```sh
# The image ships the brain CLI, Node and vendored npm dependencies.
MACRO_API_KEY=mak_... MACRO_GATEWAY=https://dev-gateway.macro.com \
BRAIN_WORKSPACE=/home/ada/workspace BRAIN_HEALTH_PORT=7801 \
BRAIN_HEALTH_MINUTES=5 BRAIN_EXECUTABLE=/opt/macro/brain \
ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... \
  brain run
brain health                     # what macrod polls, as JSON; exit 1 unless ok
```

Every variable is required; a missing one fails startup with its name. The
packaged CLI explicitly supplies its executable path and health interval; direct
Node invocations must supply both. Claude
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
                        all-mode/Jev (creator, mentions, DMs always wake) ─▶ conversation batch ─▶ cheap triage ─▶ respond
heartbeat timer / schedule wake-up ─────────────────────────────────────────▶ heartbeat turn
respond turn `brain handoff` ─▶ Macro task + work/<task>/ worktree ───────────▶ work turn ─▶ report
every turn ─▶ commit `turn <id>: <summary>` ─▶ pull --rebase ─▶ push
```

| Module | Does |
| --- | --- |
| `style.ts` | Re-read every Markdown communication guide under `prompts/style/`, except README.md, for all tiers. |
| `workspace.ts` | Persona files, `.gitignore` enforcement, the single-writer commit + push queue. |
| `events.ts` | SSE on `{dss}/webhook/events/stream`, idle watchdog, doubling reconnect, catch-up since the drop. |
| `jev.ts`, `learning.ts` | Explicit all-event start, deterministic/Jev filtering, decision and feedback history, must-wake regressions and tune tasks. |
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
| `supervisor.ts`, `host.ts` | Checked main-only activation, Node child, draining and last-known-good recovery. |
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
the canonical template's `.gitignore`. `{{creator}}` is the creating admin's Macro
user ID, so rule changes can be checked against message sender IDs.
`history/`, `log/`, `cache/` (lanes, spend ledger, heartbeat
state, Claude's config) and `work/` stay on the computer.

The template is embedded recursively by `agent_git/build.rs`, without a file
manifest. `prompts/style/README.md` indexes the communication craft library.
Every respond, heartbeat and work turn receives all its Markdown guides in the
system text after the charter, in stable path order. The initial 21 guides are
about 2,500 words (roughly 4,000 tokens); loading all avoids a selector missing
sensitive context such as frustration or discretion. The index is excluded.
Guides are re-read from the main workspace each turn, so edits and new nested
guides need no restart or loader change. Agents may improve their copies within
the charter; only the creator changes the rules or persona.

## Develop

```sh
npm ci --ignore-scripts --omit=optional
npm run vendor:sdk # fixed SDK bundle, built once for library development
npm test          # injected adapters; integration servers are loopback only
npm run check
```

## Computer image

`nix build .#macro-brain` ships the thin runner, Node 24, versioned library/SDK
source and hash-pinned npm dependencies. Both image formats include the CLI
at `/opt/macro/brain`. No compilation or library downloads happen at runtime.
See [`nix/macro-box/AGENTS.md`](../../nix/macro-box/AGENTS.md) for dependency hashes
and the service contract.

The workspace owns composition in `brain.ts` and `brain/*.ts`; imports resolve
only to the exact installed version in `brain.lock`. Run `brain check` in a work
branch before merging to main: typecheck, own tests, fake-event boot. The runner
rechecks a committed main snapshot, connects replacement intake before draining, activates and requires
continuous healthy probation (`BRAIN_HEALTH_MINUTES`, explicitly five in the image) before saving
`cache/wiring/last-good`. Failure restores wiring and records memory plus a
`cache/rewiring-notice` added to subsequent turn instructions. Remove that notice
after reading it. Ordinary memory/prompt commits do not reload wiring.

Workspace `brain.ts` runs directly with Node type stripping. The image vendors
all npm dependencies; neither runtime npm install nor an agent build step is
needed. `brain check` runs trusted `tsc --noEmit`, workspace `node:test` files and
a fake-event boot. The child receives a cleared environment; scoped credentials
enter library bootstrap through stdin and stay in adapter closures. Persona OS
identity and systemd hardening provide the process boundary.

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
The Node async-local context manager isolates concurrent turns. Macro HTTP and
SDK calls inject W3C context; Claude receives `ANTHROPIC_CUSTOM_HEADERS` so its
gateway calls join the turn. Tool subprocesses forward `BRAIN_TURN_TRACEPARENT`
back to the authenticated control server. Shutdown flushes the exporter.

Supervised children relay spans through stdout to the trusted supervisor, which
exports to the configured collector. This preserves trace IDs without giving
workspace code collector configuration or collector credentials.

The runtime contract is `prepare(signal)`, `run(signal)`, `health()`,
`post(turn, channel, text)` and `checkFixture(fixture)`. Wrappers forward all
five methods so supervisor-owned regression replay remains available. `prepare` connects and buffers events without
mutating workspace queues. The supervisor starts replacement intake alongside
the old process, then stops old intake and drains its turns before activating
replacement queue processing. Receipt IDs persist across the handoff to avoid
duplicate delivery. Every activation independently verifies a fake DM answer,
the health shape, and draining an admitted turn on abort; workspace tests cannot
replace these conformance checks.

## Calls

`src/calls/` ports the per-participant gain, local endpointing and prerecorded
rescue pipeline, turn-taking, barge-in/ducking and sentence-streamed speech.
The runner installs its Macro API watcher through `BrainDeps.calls`; a custom
`Wiring.onCall` can choose whether to invoke `brain.joinCall(call, policy)`.
See `template/docs/brain-api.md` for policies and shared memory/work behavior.

Voice selection lives in server-committed `config/voice.json`; channel opt-ins
and exclusions live in `config/calls.json`. LiveKit runs natively on Node 24.
The offline Nix package includes its platform addon and required shared libraries.
Speech uses pinned `@livekit/agents` Inference STT (`deepgram/nova-3`) and
TTS (`deepgram/aura-2`), through `/brain/inference/stt` and
`/brain/inference/tts`. These are speech primitives; the call turn machine
remains local. Agent-key authentication checks team/computer eligibility and
credit admission. The gateway signs a 60-second `inference.perform` JWT for
its upstream connection; project credentials and Cloud tokens never reach the VM.
STT seconds and Aura-2 characters are metered to team credits.

Inference preserves keyterms, interim transcripts, smart formatting and 300 ms
endpointing, plus Inference's `utterance_end` boolean. It does not expose the
separate `utterance_end_ms` control. The advertised `vad_events: true` option
failed live Cloud checks with protocol error 2006 (numeric channel decoding),
so it stays off. SDK speech-start/finalized speech-end events and the unchanged
local segmenter detect quiet speech and sustained barge-in. No batch recognition
API is available in the pinned SDK: rescue sends only the unresolved PCM span
through a fresh finalized Inference stream, with trailing silence. This costs an
extra connection plus the SDK's three-second final-transcript settlement window,
and loses Deepgram's distinct prerecorded recognition path.
There is no provider Clear command: barge-in clears local playback and terminates
the turn's TTS sockets, then starts a fresh stream for the next reply. The voice
catalog filters provider metadata to Inference-supported Aura-2 selectors; fixed
samples also synthesize through LiveKit Inference.

`npm test` includes call regressions. `calls.replayWav` runs captured audio
through the same injected ear and turn machine without a live room or model.
Diagnostics in ignored `log/calls/` are private, expire after seven days and
retain at most fifty calls, with a one-hour session limit. Transcripts and WAVs
stay out of telemetry and source control.

New templates subscribe to `*` with Jev `{ "mode": "all" }`. Unknown events
join conversation/event lanes and cheap tool-free triage before full turns.
Creator messages, DMs and mentions always wake. The daily tune schedule and
100-wake threshold create a normal work-tier branch to narrow subscriptions,
`brain/triage.ts` and Jev configuration from decision/outcome/feedback history.
`brain/fixtures/` and the supervisor's durable regression union prevent dropping
must-wake cases. Heartbeats collect reactions on the agent's own messages;
`brain react` records outbound reactions. Health and telemetry expose filter
size and wake rate without message text. Configuration is frozen with checked
wiring; style, prompt and persona text are still read fresh each turn.
