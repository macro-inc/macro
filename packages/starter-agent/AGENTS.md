# starter-agent

A template for a new agent on the muppet library: Claude, woken by events,
running from this repository. Each copy is one particular agent, with an
owner (`agent.json`).

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
5. Chat's `DESIGN.md` describes the outgoing internal-wording advisory and its
   limits; keep the charter and reply prompt aligned when changing how it talks.

## Capabilities

Everything the agent can do is a function of a capability (a module of typed
functions), and a shell calls the same ones it does:

    bin/agent list                       # the catalog, one line each
    bin/agent describe <name>...         # a capability's docs, or one function's docs and signature
    bin/agent <function> '<json>'        # call one; bare when it takes no input
    bin/agent exec <file|->              # a script exporting async main({ context, log })

Every script, and every `bin/agent <function>` call, is type-checked before it
runs: input a function doesn't take is refused with the compiler's error.

## Rules

- This checkout is live once the agent is running. Change code in a worktree
  (`.worktrees/`), never here, and bring it in with `bin/agent land`. Memory
  and `AGENT.md` are edited in place.
- Never edit `node_modules/@macro-inc/muppet`: the library is a dependency.
- Never change `muppetApi` in `package.json`: it is the muppet API the
  template was written for, and your computer's image decides which muppet
  you run on. Code can only use what that muppet has (`land` type-checks
  against it). Template authors raise it, after muppet's `apiLevel`.
- Never start a second `bin/agent run`: two would answer the same messages.
- Nothing in this repository names a particular agent, owner or product,
  outside `agent.json` and `state/`. Keep it that way: it is a template.
- Check before committing: `bun run check`.
