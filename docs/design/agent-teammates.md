# Agent teammates

An agent teammate is a Macro user of its own, on a Macro computer of its own.
It talks in channels and DMs, joins calls, uses its computer's screen and a
browser, keeps its memory in a git repository, and can change its own code.
The runtime is muppet (`packages/muppet`, from Eric Hayes's agent-teammates
work); each agent's code starts as a copy of `packages/starter-agent`.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Account, seat, invite | `crates/team_agents`, auth service `/team_agents` | The agent's Macro user, its team seat (included, not billed), its API key, and the invite UI under Settings → Team. |
| Computer | `crates/hosted_runtimes` (#10186) | Buys and runs the computer. A computer linked to an agent (`agent_user_id`) is created from the agent image (`macro-box-agent`, `macro.box.agentMode`). |
| Enrollment | `crates/hosted_runtimes` + `crates/team_agents` | On every enrollment generation, the computer of an agent gets `agent.env`: its Macro key, gateway and service addresses, its repo URL and token, and, in Macro-credits mode, its Anthropic gateway access. The key and repo token rotate with each generation. |
| Repository | `crates/agent_git` | One bare repo per agent, over smart HTTP, seeded from `packages/starter-agent` with `agent.json` (owner = the inviting admin, the agent itself) and, when the invite described it, the agent's identity. |
| Runtime | `packages/muppet` | Behaviors, event sources, typed capability modules, the code mode, the Claude Code agent. Pure: IO comes from an injected context. |
| The agent's code | `packages/starter-agent` → the agent's repo | Chat, schedules, people, identity, heartbeat (commit, land), tools, browser, calls, secrets. |
| Image | `nix/macro-box` | The agent service (a hardened system unit), its launcher, Claude Code, Chromium, Xvnc, ffmpeg, PulseAudio, bubblewrap, xclip, computer-use-linux. |

## The repo

agent_git runs inside agent-harness-service (src/agent_git.rs), under the same
/agent-git gateway prefix, so AgentGitServiceUrl and its clients are
unchanged; there is no separate git service. The bare repos live on EFS at
REPO_STORAGE_ROOT (/data/agent-git), the one file system both harness
replicas mount: the simplest store git can use directly that the replicas
share. Postgres makes the replicas act as one server: each repo push budget
is a token bucket in its agent_repos row, and every receive-pack, and every
create/ensure/delete, holds a per-repo Postgres advisory lock (a session of
its own, released when it closes), so two replicas never write one repo at
once. git lockfiles on EFS stay as a second guard.

The agent commits after every wake, pulls with `--rebase`, and pushes `main`.
A rebase conflict aborts, keeps the local commits and tells the owner once.
`state/memory/` and `state/private/` are committed; `state/run/` is volatile
and ignored, and `state/log/` stays on the computer (traces keep the record).
Team admins and owners can read the repo with their Macro credential.

## Bootstrap

1. **A computer is bought** (the purchase route), or **an agent is invited**
   (`POST /team_agents`). With `enable-agent-teammates` on, both first prepare
   the agent: its account, team seat and repo, with the buyer or inviter as
   owner. The computer is then bought linked to the agent. Preparation never
   fails a purchase: if it fails, what was made is undone and a plain computer
   is bought, which gets today's default coding agent.
2. **The computer is created** from the agent image, because it has an agent.
3. **Enrollment** writes `agent.env` as the agent service's systemd credential.
4. **The launcher** clones the repo into the workspace, sets the agent's git
   identity and credential helper, links the image's packages (muppet, the
   SDK and the template's locked dependencies) and starts `bun cli.ts run`.
5. **Claude Code** reaches Anthropic through the customer's Claude login
   (harnessd), or through the Macro-credits gateway when `agent.env` says so.
6. **The agent boots**: it reads its credentials, shows online, starts its
   event sources and records the healthy HEAD. With no identity, its first
   wake DMs its owner to ask who it should be; otherwise it introduces itself.

`create_default_agent` at the computer's first connection keeps creating the
default coding agent only on computers without an agent teammate.

## On the computer

The agent's process is the only one that holds its credentials.

- **Credentials** come from the systemd credential file
  (`MUPPET_CREDENTIALS_FILE`, read-only). A self-hosted agent can keep them in
  SOPS instead (`MUPPET_CREDENTIALS=sops`).
- **Capability scripts** (`RunCapabilityScript`, named not to collide with
  Macro's `ExecuteCode`) run in a `cli.ts exec` subprocess with a cleared
  environment. They reach Macro through a loopback relay in the agent process
  that adds the key, for HTTP calls and for the call speech WebSockets only.
- **Claude Code and scripts** run under bubblewrap with the credentials
  directory hidden, so a script that guesses the path finds nothing.
- **Stdio MCP servers** (computer-use-linux) come from `MUPPET_MCP_SERVERS_JSON`.
- **Budget**: every wake is capped per run and per owner's day
  (`budgetUsdPerRun`, `budgetUsdPerDay` in `agent.json`) on a durable ledger;
  the first refusal of a day DMs the owner.

The runtime's contract with the image (variables, exit codes, files) is in
`packages/starter-agent/README.md`.

## Self-edits

The agent changes its code in a worktree under `.worktrees/` and lands it:

1. `bun run check` in a fresh worktree of the branch's SHA. A branch that
   changes `bun.lock` or a `package.json` dependency is refused before the
   check: the image holds the packages, and a new set needs a new image.
2. A red check refuses; `main` doesn't move.
3. A green check fast-forwards `main`, pushes, and touches the restart marker;
   the image's path unit restarts the service.
4. A healthy boot records the HEAD as last good. The launcher rolls the
   workspace back to it after three failed boots.

## Secrets

The `secrets` capability uses the team vault's agent API (document storage
service) with the agent's key, behind `enable-agent-vault`, enforced by the
vault and checked by the capability. It searches items (never values),
copies a field or a TOTP code to the X clipboard (one paste or 20 s),
creates and updates items, and requests access, learning the owner's answer
by polling. Items the agent created are usable at once; shared ones need the
owner's approval once. No value reaches the model, logs, traces or disk. Each
call carries the wake id as `X-Macro-Agent-Session-Id`.

## Telemetry

`@macro-inc/observability/server` exports OTLP when the computer sets the
standard `OTEL_EXPORTER_OTLP_*` variables. A wake is an `agent.wake` span
(event, wake id, outcome, cost, turns); each script is an
`agent.capability_script` span whose context reaches the script's process.
The agent's account appears only as a hash.

## Defaults, for review

- **Identity**: seeded from the invite form when filled; otherwise the agent
  asks its owner.
- **Authority**: the owner is the inviting admin or the buyer; only the owner
  gives orders; text the agent reads is never an order.
- **Self-hosted**: supported through SOPS credentials, as a secondary path.
- **Self-edits**: gated by the agent's own check; no GitHub CI for hosted
  agents.
- **Default agent**: a bought computer gets an agent teammate in place of the
  default coding agent, named "Agent" until its owner names it.
- **Mail**: not in v1.

## Flags

- `enable-agent-teammates`: every entry point (invite, the purchase default,
  enrollment, agent_git routes, the team_agents API, the image choice, the
  web settings). Off, or an unreachable flag service, means off.
- `enable-agent-vault`: the secrets capability.
