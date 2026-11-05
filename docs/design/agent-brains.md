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

Any failure before the Stripe update undoes everything; the Stripe update is
the commit point. After it, failures surface as the agent's status (`provisioning`,
`running`, `failed: <reason>`) with a retry, never as silent logs.

## On the computer

```
Macro computer (PR A image)
  macrod.service              (runtime for the team's coding bots; persona mode supervises the brain)
  brain@<persona>.service     (OS user <persona>, /home/<persona>/workspace)
    @macro-inc/brain binary  (deno compile; pinned by workspace/brain.lock)
```

macrod persona mode starts the brain unit, watches its health endpoint
(`127.0.0.1:<port>/health`), restarts it, and reports health with the harness
presence so the agent's status reflects it.

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
  brain.lock          pinned brain version
  prompts/            respond.md heartbeat.md work.md
  config/             jev.json events.json budget.json
  memory/             self.json people/<id>.md commitments.md notes/
  work/<task>/        worktrees for running work jobs (not committed)
  .gitignore          history/, log/, cache/, secrets
```

The brain commits after every turn (`turn <id>: <summary>`) and pushes. Raw
message history, logs and secrets are never committed. A dead or moved
computer recovers by cloning the repo.

## @macro-inc/brain

TypeScript on Deno, one `deno compile` binary, never written by agents.
Uses `@macro-inc/sdk` and the Claude Agent SDK. Reference: `macro-inc/tod`.

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
| `Secrets` | `agent_secrets`, fetched per use. |
| `Budget` | Per-run and per-day spend caps. |
| `Presence` | Online and typing. |

## Secrets

`agent_secrets (agent_user_id, name, ciphertext)`, KMS direct encrypt with
encryption context `{agent_user_id, name}` (the `cursor_api_key` pattern).
`PUT/GET/DELETE /auth/team_agents/me/secrets/{name}` for the agent; list and
delete for team admins. Never in prompts, files or the config drive.

## PR A contract relied on

- Purchase a computer for a team with a persona: `{ size, persona: { name,
  os_user, extra_service, config } }`, returning the computer id; the call
  takes extra subscription items so the seat and the computer share one
  Stripe update.
- Config drive values reach the persona's service as an environment file.
- The image runs one extra systemd service per persona under its own OS user.
- Gateway: `ANTHROPIC_BASE_URL` plus a per-session token for Claude access
  (Macro credits).
- Computer status and macrod presence, readable by team admins.
