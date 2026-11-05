# @macro-inc/brain

## What it is

The agent-teammate brain (docs/design/agent-brains.md): a versioned Node 24 library plus a thin supervisor, that listens to Macro as a team agent, judges
relevance, and runs Claude Agent SDK turns in the agent's git workspace.
`README.md` maps every module.

## Start here

- `src/mod.ts`: the stable public API; `template/brain.ts`: agent-owned wiring.
- `src/supervisor.ts`: checks, main-only activation, draining and rollback.
- `src/brain.ts`: the default event-to-turn composition.
- `src/learning.ts`: local decision/outcome/feedback history, regression fixtures and tune tasks.
- `src/control.ts`: every route a turn's `brain` command can call.
- `template/`: the persona files new agent repos are seeded from.
  `prompts/style/` holds short, editable communication guides; `src/style.ts`
  reads all Markdown guides except README.md into every tier's system text.
  `crates/agent_git/src/domain/template.rs` embeds these files and renders
  persona fields plus the creating admin's Macro user ID into the charter.

## Scope

- Owns: the brain process, its CLI, and the persona template.
- Packaging: `nix/macro-box/_brain.nix` ships Node 24, the runner and offline versioned library; the image
  owns its first-start clone script and hardened `brain@` unit.
- Not here: provisioning, the repo host, secrets storage, macrod's
  supervision of the brain unit.

## Checks

- `npm run vendor:sdk`, `npm test`, `npm run check` (from this directory).
- Biome: `just check` runs it with this directory's `biome.jsonc`.

## Gotchas

- Bundle the fixed in-repo SDK with `npm run vendor:sdk` for development; image
  builds do this once. Workspace code runs directly with Node type stripping.
- Keep `package.json` and template `brain.lock` versions identical; package every
  imported runtime and test dependency offline. No runtime library downloads.
- Drain turns before stopping the control server; reload only committed wiring
  paths and filter configuration on main, never uncommitted edits or ordinary memory/style/fixture commits.
- Subprocesses run with a cleared environment (PATH, HOME, and what a turn
  needs; git alone also receives `MACRO_REPO_URL` and `MACRO_REPO_TOKEN`):
  never inherit loader variables or service secrets; turns must never see
  `MACRO_API_KEY`. Persona OS identity and systemd are the outer boundary.
- `Pool` records completed-turn time across every tier; `/health.lastTurnAt`
  feeds the computer's per-persona capability report.
- Every workspace write that the brain itself makes goes through
  `GitWriter`; never write persona files directly from new code.
- Schedule wake-ups match an `agent_session.opened` (source `routine`, owner
  the agent) to a schedule by session name starting with the routine name;
  an unmatched routine run still wakes a heartbeat with its session name.
- Inject `fetch`, `Runner`, `Tasks` and `Routines`; integration servers bind
  loopback only, and git tests use real temporary repos with a bare remote.

## Related

- Docs: `docs/design/agent-brains.md` · Rust predecessor: `crates/agent_brain` on the team-agents branch (PR 9440)

## Observability

Use `src/telemetry.ts` for brain spans and traced transports. Keep attributes to
categories, counts and opaque IDs; hash email-bearing user IDs. Telemetry is
opt-in through the persona env file; README documents its endpoint and parent.

The runtime contract is `prepare(signal)`, `run(signal)`, `health()` and
`post(turn, channel, text)`. `prepare` connects and buffers events without
mutating workspace queues. The supervisor starts replacement intake alongside
the old process, then stops old intake and drains its turns before activating
replacement queue processing. Receipt IDs persist across the handoff to avoid
duplicate delivery. Every activation independently verifies a fake DM answer,
the health shape, and draining an admitted turn on abort; workspace tests cannot
replace these conformance checks.

- New templates start with wildcard subscriptions and Jev `mode: "all"`, no
  questions or threshold. Preserve mandatory creator/DM/mention wakes and the
  growing must-wake fixture union when changing admission.
- Keep learning text in workspace files; telemetry receives only categories,
  counts and rates. Reactions are polled on owned messages until the broker
  exposes reaction facts.
