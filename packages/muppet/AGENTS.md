# muppet

## What it is

The library an agent teammate is built on. An agent is a behavior: event
sources, handlers that decide when to wake the agent, and capabilities the
agent uses by writing type-checked scripts. `DESIGN.md` is the model.

## How it works

A behavior is built by chaining (`behavior().decorate(...).source(...)
.capability(...).on(...)`) and run on a runtime. A handler wakes the agent
with a request; the agent acts by running scripts that import the functions
of its capabilities. A script is type-checked before it runs, and one that
fails isn't run.

## Start here

- `DESIGN.md`: the layout an agent's repository follows, and why.
- `core/behavior.ts`: the behavior builder and `serve`.
- `core/capability.ts`, `core/code.ts`: capabilities as modules
  of typed functions, and how scripts run.
- `utilities/scripts/index.ts`: the type checker and loader for
  scripts.
- `examples/`: two small agents that run without credentials.

## Scope

- Owns: the behavior, event, hook, capability and runtime mechanisms; the
  Claude Code agent; utilities any agent can use (schedules, jobs,
  credentials, browser, Macro chat and screen share, failures, time).
- Not here: any particular agent's prompts, memory or product logic →
  the agent's own repository, started from `../starter-agent`.

## Boundaries

- Depends on: `@macro-inc/sdk`, the Claude Agent SDK, TypeScript.
- Used by: agents rendered from `../starter-agent` by `crates/agent_git`. In
  the monorepo it resolves as the workspace package `@macro-inc/muppet`; an
  agent's image places it at `node_modules/@macro-inc/muppet` (TS source, no
  build).
- `@macro-inc/sdk` is the in-repo `packages/sdk` (workspace), built to
  `dist/` before typechecking (`bun run build` there).

## Checks

Run from this directory, after `bun install` at the root and `bun run build`
in `packages/sdk`:

- `bun run typecheck`, `bun test`
- Biome: `just check` (the shared `biome.base.jsonc`).

## Gotchas

- Follow `STYLE.md`: no type casts, no classes, pure functions with every
  dependency injected, and no path that isn't a variable.
- The library does no IO of its own and holds no paths: an agent's context
  provides both. A program a utility needs on the system (chromium, ffmpeg,
  sops) is provided by the agent's image (`nix/macro-box`), not by a flake
  here.
- Temporal comes from `temporal-polyfill`, installed by `utilities/time` and
  each package's `bunfig.toml` preload: the repo's Bun (1.3) has none. A new
  entry point that uses Temporal imports `utilities/time` or the polyfill.
- Its own style wins over the web rules where they differ: Bun APIs and
  Temporal are used on purpose (`STYLE.md`).
- A capability is a module of ordinary typed functions: the context first,
  then one input object. There are no input or output schemas; zod is only
  for data another program produced.
- Agents import this library from source and restart to pick up a change, so
  a change to an exported function is a breaking change for every agent.
