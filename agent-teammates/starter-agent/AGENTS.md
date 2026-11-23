# starter-agent

A template for a new agent on the muppet library: Claude, woken by events,
running from this repository. Once `bin/setup` has run, this copy is one
particular agent, with an owner (`agent.json`).

In one of the agent's own runs, `AGENT.md` is already your system prompt. In
any other session here, you are working on the agent: read `AGENT.md` before
changing what it does.

1. `AGENT.md` is its charter: how it works. Who it is comes from its owner,
   in conversation, and is kept in `state/memory/identity/identity.md`. Never
   write a personality into the charter or the code.
2. `ARCHITECTURE.md` is how the code is laid out and the rules it keeps. Read
   it before changing anything under `behavior/`.
3. `ENGINEERING.md` is how a change or a fix is made.
4. Its memory is `state/memory/`: `shared/notes.md` first.

## Capabilities

Everything the agent can do is a function of a capability (a module of typed
functions), and a shell calls the same ones it does:

    bin/agent list                       # the catalog, one line each
    bin/agent describe <name>...         # a capability's docs, or one function's docs and signature
    bin/agent <function> '<json>'        # call one; bare when it takes no input
    bin/agent exec <file|->              # a script exporting async main({ context, log })

Every script, and every `bin/agent <function>` call, is type-checked before it
runs: input a function doesn't take is refused with the compiler's error.

`bin/agent` enters the nix shell by itself. Already inside it (`nix develop`),
set `AGENT_SHELL=1`.

## Rules

- This checkout is live once the agent is running. Change code in a worktree
  (`.worktrees/`), never here, and bring it in with `bin/agent land`. Memory
  and `AGENT.md` are edited in place.
- Never edit `../muppet`: the library is a dependency.
- Never start a second `bin/agent run`: two would answer the same messages.
- Nothing in this repository names a particular agent, owner or product,
  outside `agent.json` and `state/`. Keep it that way: it is a template.
- Check before committing: `bun run check`.
