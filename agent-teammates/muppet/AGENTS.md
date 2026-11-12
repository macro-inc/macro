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
- `packages/lib/core/behavior.ts`: the behavior builder and `serve`.
- `packages/lib/core/capability.ts`, `core/code.ts`: capabilities as modules
  of typed functions, and how scripts run.
- `packages/lib/utilities/scripts/index.ts`: the type checker and loader for
  scripts.
- `packages/lib/examples/`: two small agents that run without credentials.

## Scope

- Owns: the behavior, event, hook, capability and runtime mechanisms; the
  Claude Code agent; utilities any agent can use (schedules, jobs,
  credentials, browser, Macro chat and screen share, failures, time, wake
  telemetry).
- Not here: any particular agent's prompts, memory or product logic →
  the agent's own repository, started from `../starter-agent`.

## Boundaries

- Depends on: `@macro-inc/sdk`, the Claude Agent SDK, TypeScript, and the
  OpenTelemetry SDK (only for `utilities/telemetry`).
- Used by: agents built from `../starter-agent`, which link `packages/lib`.
- Not in the root workspace: it has its own `package.json`, `bun.lock` and
  `flake.nix`, and the root checks don't cover it.

## Checks

Run from this directory:

- `nix develop --command sh -c 'bun install && bun run typecheck && bun test && bun run format:check'`

## Gotchas

- Follow `STYLE.md`: no type casts, no classes, pure functions with every
  dependency injected, and no path that isn't a variable.
- The library does no IO of its own and holds no paths: an agent's context
  provides both. A utility that needs a program on the system ships a
  `flake.nix` beside it.
- A capability is a module of ordinary typed functions: the context first,
  then one input object. There are no input or output schemas; zod is only
  for data another program produced.
- Agents import this library from source and restart to pick up a change, so
  a change to an exported function is a breaking change for every agent.
