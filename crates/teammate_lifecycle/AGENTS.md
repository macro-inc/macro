# teammate_lifecycle

## What it is

The lifecycle controller of agent teammates: the one interpretation of the
agent's exit codes, shared by `teammate-boot` (inside the container or the
hosted unit) and macrod's supervisor. Plan: `docs/design/teammate-runtime.md`,
*Lifecycle controller*; exit table: *The runtime contract*.

## Start here

- `src/exit.rs`: the exit-code table and `TEAMMATE_PREVIOUS_EXIT`.
- `src/boot.rs`: `count_previous`, `admit`, `plan_boot` (pure).
- `src/supervisor.rs`: `PolicyState` (persisted by macrod) and its `exited`,
  `resume`, `redelivered`.
- `src/replacement.rs`: `ImageUpdate`, the image swap and its rollback.
- `src/runner.rs`: a boot's effects behind the `Git`, `Fs` and `Runtime` ports.
- `src/bin/teammate-boot.rs`: the launcher binary; replaces `start-agent` and
  `agent-stopped`.

## Scope

- Owns: exit semantics, boot rollback/lock/muppet-level decisions, restart
  backoff and rate cap, image replacement policy.
- Not here: running containers or units (`crates/coding_agent_worker/src/teammate`),
  the image (`nix/macro-box`), herdr sessions and ACP children (never supervised).

## teammate-boot contract

`teammate-boot run --workspace --last-good --failed-boots --boot-head --runtime
--credential-helper --helper-credentials`, with `MUPPET_CREDENTIALS_FILE` and
`TEAMMATE_PREVIOUS_EXIT` (`unknown` or 0-255, required; a supervisor passes 0
for any exit of a stop it asked for) in the environment. It execs
`bun <workspace>/cli.ts run` or exits 77, 78 or 79 (`src/exit.rs`), or 1 when
a step fails (git, a file). `SIGTERM`
during the boot kills its children's process groups and exits 143.

## Checks

- `cargo test -p teammate_lifecycle` (needs `git` on `PATH`; the runner tests
  use real repositories in temporary directories).

## Gotchas

- Change an exit code's meaning only together with the table in the design
  doc and `packages/starter-agent/README.md`.
- `PolicyState` and `ImageUpdate` are persisted: renaming their serde fields
  breaks macrod's install store.
- The boot's messages ("starting the runtime at", "needs a newer image: …")
  are read by the image's contract test; keep them.
