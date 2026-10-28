# coding-agent-worker

## What it is

Agent sessions feature: Bun/Hono service that boots a sandboxed container
running a coding agent (opencode) and relays ACP frames between it and
`agent_proxy`, triggered by a `start_agent_session <repo-url> [prompt...]`
chat message.

## Start here

- `index.ts`: webhook ingress — matches the trigger message, resolves the repo,
  kicks off a session.
- `src/session.ts`: `SessionRouter` — relays ACP frames verbatim between the
  sandbox's websocket and `UpstreamLink`. This worker never speaks ACP itself;
  `agent_proxy` owns the ACP session and handshake.
- `src/provision.ts`: the idempotent script that turns a booted container into
  a ready sandbox (clone repo, start the sidecar). Coupled to the container
  image (`container/Dockerfile`), not to any provider.
- `src/providers/daytona.ts`: the current `CommandRunner`/`AgentSandbox`
  implementation (Daytona). Add a new provider by implementing `interfaces.ts`.
- `src/webhook.ts`: registers/repairs the Macro webhook subscription
  (`message.posted`) via `@macro-inc/sdk`.
- `container/`: the Dockerfile and flake baking the dev shell + opencode
  sidecar into the sandbox image.

## Scope

- Owns: provisioning sandboxes, relaying ACP frames, and the chat trigger that
  starts a session.
- Not here: the ACP protocol/session semantics themselves → `agent_proxy`; the
  Rust-side agent runtime protocol types → `crates/agent_runtime_protocol`
  (regenerate `src/protocol/generated.ts` from there, don't hand-edit it).

## Recipes

- Add a sandbox provider: implement `CommandRunner`/`AgentSandbox` from
  `src/interfaces.ts` → wire it in `src/session.ts`.
- Regenerate protocol types after a Rust change:
  `just gen-protocol` (runs `cargo run -p agent_runtime_protocol --bin export_types`).
- Change the container image: `container/Dockerfile` → `just build-image`.

## Checks

- `just typecheck` (`bunx tsc --noEmit`).
- `bun test` for `src/*.test.ts` (`src/upstream.test.ts`, `src/provision.test.ts`).

## Gotchas

- `src/protocol/generated.ts` is generated from Rust Specta types; never
  hand-edit it — rerun `just gen-protocol`.
- `assertSafeRepoUrl` in `src/provision.ts` is the only guard against shell
  injection into the provisioning script; any new provisioning step that
  interpolates untrusted strings needs the same care.
