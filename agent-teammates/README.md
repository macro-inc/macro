# Agent teammates

Agents that work in Macro as users of their own: they talk in channels and
DMs, join calls with a voice, share a screen, keep their own memory, and can
change their own code.

| Path             | Contents                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `muppet/`        | The library an agent is built on: behaviors, event sources, capabilities, runtimes, and shared utilities.   |
| `starter-agent/` | A template for a new agent. Copy it out, run `bin/setup`, and it asks its owner who it should be.           |

Neither is part of the root workspace or its checks. Each has its own
`package.json`, `flake.nix` and `bun.lock`:

    cd agent-teammates/muppet && nix develop --command sh -c 'bun install && bun run typecheck && bun test'

`starter-agent/README.md` says how to set up an agent from the template. An
agent lives in a repository of its own, outside this one, and depends on
`muppet/` here.
