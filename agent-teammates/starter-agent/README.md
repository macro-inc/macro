# starter-agent

A new agent, ready to become someone's. Copy this directory, point it at the
muppet library, run `bin/setup`, and you have an agent with its
own Macro account that talks with you in chat, joins calls with its voice,
shares its screen, keeps its own memory, and can change its own code.

It is not anyone yet. It has no name, no purpose and no personality: the
first thing it does is DM its owner to ask who it should be, and what it is
told becomes part of every later run.

- `AGENT.md` is its charter: how it works. It says nothing about who it is.
- `ARCHITECTURE.md` is how the code is laid out and the rules it keeps.
- `ENGINEERING.md` is how a change or a bug fix is made.
- `CLAUDE.md` is where a Claude Code session in this repository starts.
- This file is how to set one up and run it.

## Set one up

You need:

- **nix**, with flakes. `flake.nix` provides bun, sops, age, git, ffmpeg and
  chromium; `bin/agent` and `bin/setup` enter that shell by themselves.
- **Claude Code**, installed and signed in as the user the agent runs as. The
  agent is Claude Code, through the Agent SDK.
- **muppet**, on this machine: beside the agent's directory (`../muppet`), or
  `MUPPET` set to where it is.
- **A Macro account for the agent**, separate from yours, and an API key for
  it.

Then, one copy of this directory per agent, named for the agent or its owner,
somewhere that is not inside another git repository. The agent commits its
memory to its own repository after every wake, so `bin/setup` refuses to run
inside someone else's.

    cp -r starter-agent ~/ada-agent
    cd ~/ada-agent
    MUPPET=/path/to/muppet bin/setup

`MUPPET` is only needed when muppet isn't at `../muppet` from the copy.

`bin/setup` asks for your Macro email (the owner: the only account that can
give the agent orders), the agent's Macro email and API key, and your time
zone. It writes `agent.json`, encrypts the key into `secrets.enc.json` with an
age key (made at `~/.config/sops/age/keys.txt` if this machine has none: back
it up), installs packages, commits, and offers to install and start the
agent as a systemd user service named after the directory.

Once it is running, it DMs you in Macro. Answer it: that conversation is how
it learns its name, its purpose and how to talk. It writes what you tell it
to `state/memory/identity/identity.md`.

## What it can do

| Area        | What                                                                    | Needs, beyond its Macro key         |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------- |
| `chat`      | Read and post in Macro channels, threads and DMs; answer when spoken to | nothing                             |
| `identity`  | Know who it is, from what its owner told it                             | nothing                             |
| `later`     | Hand itself longer tasks to do in a run of their own                    | nothing                             |
| `people`    | Remember the people it talks with, on this machine only                 | nothing                             |
| `heartbeat` | Schedules, its own clock, and changing its own code (`commit`, `land`)  | nothing                             |
| `tools`     | Its credentials, by name                                                | nothing                             |
| `calls`     | Join, place and leave Macro calls with a voice; post in a call's chat   | speech credentials (see below)      |
| `screen`    | Show a browser on a call                                                | the screen service running          |
| `mail`      | An inbox of its own, screened before it reaches it                      | a Gmail account's OAuth credentials |

An area whose credentials are missing stays quiet: nothing fails, and the
agent says which credential to add when asked to use it. "Credentials" below
lists them.

## Credentials

The agent's credentials are in `secrets.enc.json`, encrypted with SOPS to this
machine's age key. They are used by name and never printed.

    bin/agent listCredentials
    bin/agent describe setCredential

`setCredential` takes the value on stdin, never as an argument; its docs give
the exact input. The agent can also be told, in chat, to add one.

| Credential                                                   | What it turns on                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `MACRO_API_KEY`                                              | The agent itself: chat, schedules, memory. Set by `bin/setup`.       |
| `DEEPGRAM_API_KEY`                                           | Calls: hearing, and the default voice. Without it no call is joined. |
| `INWORLD_API_KEY`                                            | Only if the agent's voice is changed to an Inworld one.              |
| `MAIL_CLIENT_ID`, `MAIL_CLIENT_SECRET`, `MAIL_REFRESH_TOKEN` | Mail: a Gmail account's OAuth client and refresh token.              |
| `AGENT_GITHUB_TOKEN`                                         | Pushing its repository to a remote, and landing through a PR and CI. |

Calls and mail check for their credentials again every few minutes, so
adding one turns the feature on without a restart.

## How it runs

One process, `bin/agent run`, under a systemd user unit. It builds the
behavior in `behavior/`, shows the agent online in Macro, and waits on its
event sources. A handler decides cheaply what each event needs, and wakes the
agent (Claude Code, with `AGENT.md` and who it is as its system prompt) only
when it is needed.

A run that answers a message only talks. Anything longer the agent hands to
itself (`doLater`) and is woken for on its own. Every wake ends with a commit
of this repository.

Each call the agent is on is a process of its own (`bin/agent joinCall`), so
a call outlives a restart of the agent. The browser it shares from is a
second unit, `<name>-screen.service`.

## Operate

    systemctl --user status <name>          # is it up
    systemctl --user restart <name>         # picks up new code, settings and credentials
    journalctl --user -u <name> -f          # what it is doing

    bin/agent list                          # its catalog, one line per capability
    bin/agent describe <name>...            # a capability's docs, or one function's docs and signature
    bin/agent <function> '<json>'           # call a function; bare when it takes no input
    bin/agent exec <file|->                 # run a script exporting async main({ context, log })

    nix develop --command bun run check     # typecheck, tests, format

`<name>` is the directory's name. Several agents can run on one machine, each
in its own copy, with its own Macro account, sharing the machine's age key.

Never start a second `bin/agent run` for the same agent: both would answer
the same messages.

## Layout

    index.ts, cli.ts, bin/agent    build the behavior; run the agent, or call any function
    bin/setup                      turn a fresh copy into one particular agent 
    AGENT.md                       the charter: every run's system prompt
    agent.json                     who it is in Macro, who owns it, the name it commits under
    secrets.enc.json, .sops.yaml   credentials, encrypted with SOPS (age)
    behavior/
      index.ts                     the whole behavior, composed from the areas
      context/                     the one place IO happens: disk, clock, shell, credentials, Macro
      agent/                       the agent as Claude Code, its limits per event, its guards
      events/sources/<area>.ts     where events come from
      events/handlers/<area>.ts    what happens when one fires
      capabilities/<area>/         what it can do, its prompts, and all of the area's logic
    state/
      memory/<owner>/              committed: what it knows
      private/<owner>/             never committed: people, their messages, mail
      run/<owner>/                 never committed: queues, cursors, locks
      log/<owner>/                 never committed: logs and recordings
    systemd/                       templates for its user units
