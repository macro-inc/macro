# @macro-inc/brain

## What it is

The agent-teammate brain (docs/design/agent-brains.md): a Deno program, one
`deno compile` binary, that listens to Macro as a team agent, judges
relevance, and runs Claude Agent SDK turns in the agent's git workspace.
`README.md` maps every module.

## Start here

- `src/brain.ts`: the wiring from events to turns and commits.
- `src/control.ts`: every route a turn's `brain` command can call.
- `template/`: the persona files new agent repos are seeded from.

## Scope

- Owns: the brain process, its CLI, and the persona template.
- Packaging: `nix/macro-box/_brain.nix` builds the image binary; the image
  owns its first-start clone script and hardened `brain@` unit.
- Not here: provisioning, the repo host, secrets storage, macrod's
  supervision of the brain unit.

## Checks

- `deno task test`, `deno task check`, `deno task compile` (from this directory).
- Biome: `just check` runs it with this directory's `biome.jsonc`.

## Gotchas

- Imports the in-repo SDK source (`../sdk/src`) with `sloppy-imports`; an SDK
  change can break this build, so run `deno task check` after one.
- `deno compile` excludes the Agent SDK's bundled Claude binaries (600 MB);
  the brain drives `claude` on `PATH`. Bumping the Agent SDK version means
  updating both `--exclude` paths in `compile.sh`. Compiler options passed to
  `deno task compile` must precede the entrypoint (the wrapper handles this).
- Subprocesses run with a cleared environment (PATH, HOME, and what a turn
  needs; git alone also receives `MACRO_REPO_URL` and `MACRO_REPO_TOKEN`):
  Deno's `--allow-run=git,claude` refuses loader variables such as
  `LD_LIBRARY_PATH`, and turns must never see `MACRO_API_KEY`.
- `Pool` records completed-turn time across every tier; `/health.lastTurnAt`
  feeds the computer's per-persona capability report.
- Every workspace write that the brain itself makes goes through
  `GitWriter`; never write persona files directly from new code.
- Schedule wake-ups match an `agent_session.opened` (source `routine`, owner
  the agent) to a schedule by session name starting with the routine name;
  an unmatched routine run still wakes a heartbeat with its session name.
- Tests never touch the network: inject `fetch`, the `Runner`, `Tasks` and
  `Routines`; git tests use real temp repos with a bare remote.

## Related

- Docs: `docs/design/agent-brains.md` · Rust predecessor: `crates/agent_brain` on the team-agents branch (PR 9440)
