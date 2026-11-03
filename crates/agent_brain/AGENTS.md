# agent_brain

## What it is

Team agents: a toolkit a team agent's local coding agent compiles into its
own long-running daemon (events → relevance → per-conversation queue → wake,
plus heartbeats). Agents depend on it by git from their own machines, so the
README is written for them, not for Macro engineers.

## Start here

- `README.md`: the agent-facing guide; embeds `examples/daemon.rs`.
- `src/lib.rs`: module map and re-exports.
- `examples/daemon.rs`: how the parts compose.

## Scope

- Owns: HTTP calls as a team agent's user (`x-macro-user-api-key`), event
  stream decoding and reconnect, the relevance file format, durable queues,
  wakers, schedules, and the state directory layout.
- Not here: the backend endpoints it calls (storage, auth `team_agents`,
  cognition `decisions`, agent-harness sessions); the TypeScript equivalent
  is `packages/sdk`.

## Boundaries

- Depends on: third-party crates only, through `{ workspace = true }`.
- Used by: daemons on agents' machines (`git` dependency on `main`), not by
  any workspace crate.

## Recipes

- Add an endpoint: types in `src/client/types.rs` → method in
  `src/client.rs` → wiremock test in `src/client/test.rs`. Copy paths and
  shapes from `packages/sdk/generated/*/types.gen.ts`.
- Model another event: struct + `EventKind` variant + `parse_envelope` arm
  in `src/events.rs`.
- Change the example: edit `examples/daemon.rs`, then paste it over the
  `rust` block in `README.md` (they must stay identical).

## Checks

- `cargo test -p agent_brain`
- `cargo clippy -p agent_brain --all-targets -- -D warnings` (builds the example)

## Gotchas

- Never depend on `workspace-hack` or any `macro_*`/workspace crate: the
  crate must build outside this repo. It is excluded from hakari in
  `.config/hakari.toml`.
- Config comes from plain env vars (`MACRO_API_KEY`, then `MACRO_GATEWAY` or
  `MACRO_ENV`) read with
  `std::env::var_os`; `macro_config`/`macro_service_urls` don't apply off
  Macro's infrastructure. Host URLs mirror `packages/sdk/src/config.ts`;
  update both when a gateway path changes.
- The API surface is public to agents in the wild; renaming a public item or
  a JSON field (`relevance.json` keys, state file names) breaks their builds
  or state. Add, don't rename.
- Never log message content, prompts, or the API key; spans carry ids only.

## Related

- Rules: `.agents/rules/rust/code.md` · Inspiration: an earlier hand-built
  team agent (event listener, Jev, per-channel queue, `claude -p` responder).
