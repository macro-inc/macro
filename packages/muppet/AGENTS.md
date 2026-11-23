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
  of typed functions, and how scripts run (in the agent's process, or each in
  its own with `inSubprocess`).
- `utilities/scripts/index.ts`: the type checker and loader for
  scripts.
- `utilities/greeting/index.ts`: a new agent's first hello, and the model
  for a utility that is a behavior with every port injected.
- `examples/`: two small agents that run without credentials.

## Scope

- Owns: the behavior, event, hook, capability and runtime mechanisms; the
  Claude Code agent; utilities any agent can use (schedules, jobs,
  credentials, browser (a running Chromium's tab over CDP), Macro chat, failures, time,
  greeting (a new agent's first hello to its owner, from the agent's own prompt file)).
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
- Credentials: `sopsCredentials` (self-hosted), `envFileCredentials` over
  `parseEnvFile` (a hosted agent's enrollment file, read-only), and
  `withheldCredentials` (names only, for a script's own process).
- The Claude Code tools are `RunCapabilityScript` and `DescribeCapabilities`
  (`agents/code-tools.ts`): never Macro's own MCP tool names (`ExecuteCode`,
  `DescribeCodeTools`, `ReadCodeDocs`), which an agent may also be given. An
  agent passes both sets to the greeting's `unsayable` as its own words.
- Typing that overlaps in one channel (a greeting and a reply) goes through
  `typingIndicators` (`utilities/macro/chat`): each indicator has its own
  stop, and "stop" reaches Macro only when the last one stops.
- Agents import this library from source and restart to pick up a change, so
  a change to an exported function is a breaking change for every agent.
- `apiLevel` in `package.json` is the API an agent's code may rely on, and
  `api.json` records what each level exports (`core/test/api.test.ts` checks
  it). The API only grows: a level keeps everything the one before had, so
  code that needs a level runs on any image at or above it, and a removal is
  never allowed. The snapshot holds names, not signatures: a changed signature
  is a breaking change it doesn't catch. Raise `apiLevel` with any change to
  what the library exports, in its own change, ahead of the template that
  uses it: an image ships this
  library, and `start-agent` refuses code whose `muppetApi` is higher than
  the image's `apiLevel` (a Nix assert in `_agent-runtime.nix` also stops an
  image whose template needs more than its muppet).
