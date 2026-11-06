# Agent brains

An agent teammate is a real Macro user with its own computer. An admin invites
one and buys its computer in one step; Macro creates the account, provisions a
Macro computer (hosted runtime) with a persona, creates the agent's git repo,
and the brain starts on the computer. Builds on Eric's #9440 (account, seat,
inbox, API key) and on Macro computers (PR A).

## Invite and buy

Settings → Members → **Invite agent**: name, role (job description), size.

1. `GET /auth/team_agents/quote?size=` returns the seat price and the computer
   price for the team's billing interval.
2. The admin confirms one total.
3. `POST /auth/team_agents` creates, in order: the inbox, the account rows,
   the team membership, the agent's API key, its repo (seeded from the persona
   template), and the computer purchase. The seat and the computer are added
   to the team subscription in **one** Stripe update (`AlwaysInvoice`).
4. The computer boots with the persona's config drive, the brain clones the
   repo, connects, and DMs the admin.

Failures before a saved computer purchase undo the agent resources. The durable
computer row and payment effect precede Stripe; an unknown billing outcome stays
`PendingPayment` and replays idempotently, while the agent shows "Confirming
payment". A definite `PaymentFailed` shows `failed: payment failed` with Retry
hidden; the admin releases the agent or re-invites. Provisioning failures keep
the saved computer and credentials, with `retryable: true`. Brain health failures
surface as status diagnostics without offering a computer provisioning retry.

## On the computer

```
Macro computer (PR A image)
  macrod.service              (runtime for the team's coding bots; persona mode supervises the brain)
  brain@<persona>.service     (OS user <persona>, /home/<persona>/workspace)
    brain supervisor → Node 24 → workspace brain.ts → @macro-inc/brain (brain.lock)
```

The shared Incus/Docker rootfs installs the thin runner at `/opt/macro/brain`,
Node 24, and versioned library source plus vendored npm dependencies. No library
fetch or compilation happens on the computer. Enrollment creates the persona OS user and its concrete
unit; the image's `brain@.service.d/image.conf` applies the same startup wrapper
and hardening to those units as to the template. Only the persona home and
private `/tmp` are writable. First start clones the repo to
`/home/<os_user>/workspace` atomically; retries preserve an existing clone.
Git identity uses the OS username and the email in `MACRO_AGENT_USER_ID`.
The exact-repo git credential helper reads `MACRO_REPO_TOKEN` from the git
process environment; no token is stored in `.git/config` or sent to Claude.

macrod stays unprivileged. On an enrolled computer it uses the image's
existing noninteractive sudo access to discover only persona names/ports and
control `brain@<os_user>` units. It starts stopped units and recovers failed
units with a 5-second to 5-minute backoff; systemd handles ordinary crash
restarts. Every 15 seconds it polls `127.0.0.1:<port>/health`, independently per
persona. Running but degraded brains are reported rather than restarted.

The existing authenticated capability report persists a `personas` map in
harness JSON: healthy/unhealthy/missing, observation time, last error when
applicable, and last completed turn. The brain supplies `lastTurnAt`; macrod
retains it across unavailable probes. Consumers combine harness connection
presence with `checked_at` freshness when deciding whether an observation is
live. No persona credential enters this report; older harnesses keep an empty
persona map.

## The workspace repo (Macro-hosted git, 1:1)

`agent_git_service` hosts exactly one bare repo per agent, created with the
agent and deleted with it. Smart HTTP (`git http-backend`) behind axum auth:

- the agent's repo token (minted at creation, stored hashed) reads and
  pushes only its own repo;
- team admins read it with their normal session.

Limits per repo: size cap, push rate, no LFS. Storage is a volume (EFS in AWS,
a docker volume in run_local).

```
workspace/
  OPERATING.md        charter, voice, who may change what
  brain.ts            agent-owned composition
  brain/              agent-owned handlers, triage.ts, modules, tests and fixtures/
  brain.lock          exact installed library version
  docs/brain-api.md    typed library reference
  prompts/            respond.md heartbeat.md work.md
  prompts/style/      21 craft guides appended to system text each turn (README excluded)
  config/             jev.json events.json budget.json
  memory/             self.json people/<id>.md commitments.md notes/
  work/<task>/        worktrees for running work jobs (not committed)
  .gitignore          history/, log/, cache/, secrets
```

The brain commits after every turn (`turn <id>: <summary>`) and pushes. Raw
message history, logs and secrets are never committed. A dead or moved
computer recovers by cloning the repo.

## @macro-inc/brain

A versioned Node 24 TypeScript library with a stable `src/mod.ts` public API, using
`@macro-inc/sdk` and the Claude Agent SDK. The agent owns its composition in
`brain.ts`, imports `@macro-inc/brain` at the exact version in `brain.lock`, and
can add handlers, subscriptions, relevance, tiers, schedules and tools in
`brain/*.ts`. The template starts permissively: every accessible event, Jev all mode and cheap triage per conversation, then learns to narrow.

The trusted supervisor runs the committed wiring snapshot from `main` in a
separate Node process, using native TypeScript stripping. The image vendors npm
dependencies and the fixed SDK; no runtime npm install, library fetch or agent
build step is needed. Checks have fake adapters and no credentials. A cleared
child environment and library adapters keep service credentials out of turns.
Persona OS identity and systemd hardening provide the outer process boundary.

`brain check` runs trusted `tsc --noEmit`, workspace `node:test` files and dry-boots a fake direct message
through a completed turn. Agents edit on a work-tier branch/worktree, run checks,
and merge to main. The supervisor repeats checks, connects replacement intake
and buffers its events, then stops old intake and drains in-flight turns with
their control server still available before activating replacement processing.
Ordinary memory, fixture, style and prompt commits do not reload wiring. A candidate must
remain healthy for `BRAIN_HEALTH_MINUTES` (default five) before last-known-good is
persisted. Check, boot or health failure restores the last-known-good composition,
restores only wiring paths in git when safe, records the reason in memory, and
adds it to subsequent turn instructions. Uncommitted wiring is never overwritten.
Initial startup without any healthy revision fails closed. Library version bumps
follow exactly the same check, activation and recovery path; versions must already
be shipped in the image. macrod's `/health` contract is unchanged.

| Primitive | Does |
| --- | --- |
| `Workspace` | Load persona files; commit + push after turns (single writer). |
| `Events` | Event stream with reconnect and catch-up since the last event. |
| `Jev` | Relevance via `decide`, `config/jev.json`, fast paths for mentions/DMs, decision log. |
| `Lanes` | One durable serial queue per conversation; bursts batch; crash replays. |
| `Pool` | Concurrency per tier (respond, heartbeat, work) and one speaking turn at a time. |
| `Runner` | `start(turn) → { events, inject, abort, done }`; Agent SDK in-process. |
| Tiers | `respond` (talk only, short), `heartbeat` (gated by a cheap snapshot), `work` (hand-off → Macro task + worktree, reports back, receives injected follow-ups). |
| `Schedules` | Macro routines targeting the agent itself. |
| `Memory` | `remember`/`recall`/`forget` and the self-state record, files under `memory/`. |
| `Budget` | Per-run and per-day spend caps. |
| `Presence` | Online and typing. |

## Bootstrap credentials

The bootstrap API key and repo token follow the
[persona config contract](../../crates/team_agents/AGENTS.md). The agent's own
API key also authorizes its dedicated Anthropic route; it is not a shared service
credential.

## PR A contract relied on

- Purchase a computer for a team with a persona: `{ size, persona: { name,
  os_user, extra_service, config } }`, returning the computer id; the call
  takes extra subscription items so the seat and the computer share one
  Stripe update.
- Config drive values reach the persona's service as an environment file.
- The image runs one extra systemd service per persona under its own OS user.
- Gateway: `ANTHROPIC_BASE_URL=<egress>/brain/anthropic` and the agent's own
  revocable API key as `ANTHROPIC_AUTH_TOKEN` (Macro credits), gated by its
  team's Running computer; Frozen wake finishes first. See the
  [gateway contract](../../crates/hosted_runtimes/AGENTS.md).
- Computer status and macrod presence, readable by team admins.

The runtime contract is `prepare(signal)`, `run(signal)`, `health()` and
`post(turn, channel, text)`. `prepare` connects and buffers events without
mutating workspace queues. The supervisor starts replacement intake alongside
the old process, then stops old intake and drains its turns before activating
replacement queue processing. Receipt IDs persist across the handoff to avoid
duplicate delivery. Every activation independently verifies a fake DM answer,
the health shape, and draining an admitted turn on abort; workspace tests cannot
replace these conformance checks.

New agents subscribe to the live stream's additive `events: ["*"]` filter;
per-event entity/workspace authorization is unchanged, and persisted webhook
matching remains exact. Jev starts as `{ "mode": "all" }`, without questions or
threshold. Creator messages, DMs and mentions always wake; ordinary event
batches use a cheap tool-free triage tier before a full turn, sharing the daily
cap through concurrency-safe reservations.

The local decisions log joins filter decisions with wakes, posts, reactions,
ignored outcomes and human corrections. Reaction feedback is polled on the
agent's own posts because the message broker has no reaction fact. Telemetry
contains only categories/counts/rates; `/health` adds `filterSize` and `wakeRate`
without changing existing supervisor fields. The template's daily tune
`onSchedule` and every 100 wakes create a normal work-tier maintenance task on a
branch/worktree. It reviews evidence, narrows subscriptions/deterministic triage/
Jev step by step, runs `brain check`, then commits and merges to main.

The growing `brain/fixtures/` set protects creator messages, DMs, mentions,
successful actions and reported misses. Every activation replays the union of
tracked fixtures and an independent local regression registry, so deleting a
fixture in a proposal cannot weaken checks. Filtering config and composition
are frozen to the checked snapshot; both use the same activation/revert path.
Style guides, prompts and persona text stay fresh on every turn.
