# starter-agent

A new agent, ready to become someone's: an agent with its own Macro account
that talks with you in chat, joins calls with its voice, shares its screen,
keeps its own memory, and can change its own code.

When its owner described it in the invite, that is who it is
(`state/memory/identity/identity.md`). When they didn't, it is not anyone
yet: the first thing it does is DM its owner to ask who it should be, and
what it is told becomes part of every later run.

- `AGENT.md` is its charter: how it works. It says nothing about who it is.
- `ARCHITECTURE.md` is how the code is laid out and the rules it keeps.
- `ENGINEERING.md` is how a change or a bug fix is made.
- `CLAUDE.md` is where a Claude Code session in this repository starts.
- This file is how one is made and run.

## How one is made

Inviting an agent teammate in Macro makes its account, buys it a computer and
creates this repository for it on Macro's agent git server, rendered from
`packages/starter-agent` in the Macro monorepo: `agent.json` names its owner
(the admin who invited it) and itself. The computer's image clones the
repository, provides `@macro-inc/muppet`, `@macro-inc/sdk`, Claude Code and
the programs the capabilities use, and runs `bin/agent run` as a system
service.

Once it is running, it DMs you in Macro. Answer it: that conversation is how
it learns its name, its purpose and how to talk. It writes what you tell it
to `state/memory/identity/identity.md`.

## What it can do

| Area        | What                                                                    | Needs, beyond its Macro key         |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------- |
| `chat`      | Read and post in Macro channels, threads and DMs; answer when spoken to | nothing                             |
| `identity`  | Know who it is, from what its owner told it                             | nothing                             |
| `later`     | Hand itself longer tasks to do in a run of their own                    | nothing                             |
| `people`    | Remember the people it talks with, in its private state                 | nothing                             |
| `heartbeat` | Schedules, its own clock, and changing its own code (`commit`, `land`)  | nothing                             |
| `tools`     | Its credentials, by name                                                | nothing                             |
| `secrets`   | The team's vault: search, copy a field or TOTP code to the clipboard, create and update, request access; never a value | the `enable-agent-vault` flag on the team; `xclip` and `timeout` on the computer |
| `calls`     | Join, place and leave Macro calls with a voice; post in a call's chat   | nothing (speech is Macro's gateway) |
| `browser`   | Its own browser on its screen: open, read, click, type, paste a vault secret into a login form, screenshot | `chromium` on the computer, `DISPLAY` |

An area whose credentials are missing stays quiet: nothing fails, and the
agent says which credential to add when asked to use it. "Credentials" below
lists them.

## Credentials

A hosted agent's credentials are its enrollment's `agent.env` (`KEY=value`
lines, given as a systemd credential at `MUPPET_CREDENTIALS_FILE`): its Macro
key and where Macro is (`MACRO_GATEWAY`, the `OVERRIDE_*` service URLs and
`MACRO_SPEECH_URL`, the speech gateway a call's relay opens `…/stt` and
`…/tts` under),
its repository's, and, in Macro-credits mode, `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, the
only ones Claude Code is given. They are read once, only read, used by name
and never printed; the agent can't add one (its owner adds it to the
enrollment). A self-hosted agent sets `MUPPET_CREDENTIALS=sops` instead, and
keeps them in `secrets.enc.json`, encrypted with SOPS to its machine's age
key, where its owner adds one with `sops`. `setCredential` and
`useCredential` refuse in a script's process, which is where the catalog runs
them.

    bin/agent listCredentials

Scripts the agent writes, and Claude Code itself, never hold a credential:
each script runs in a process of its own, with a cleared environment, and
reaches Macro through a loopback relay in the agent's process, which adds
the key. There `listCredentials` still lists the names; reading a value
fails.

| Credential                                                   | What it turns on                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `MACRO_API_KEY`, `MACRO_GATEWAY`                             | The agent itself: chat, schedules, memory. Set by enrollment.        |
| `AGENT_GITHUB_TOKEN`                                         | Only with a GitHub remote: landing through a PR and CI.              |


## How it runs

One process, `bin/agent run`, under the computer's agent service, which sets
`AGENT_WORKSPACE` (this repository), `MUPPET_CREDENTIALS_FILE`,
`MUPPET_LAST_GOOD_FILE`, `MUPPET_RESTART_FILE` and, for stdio MCP servers
every wake gets (e.g. computer use), `MUPPET_MCP_SERVERS_JSON`. None has a
default: a missing or invalid one exits 78. The launcher counts a 78 as a
failed boot, so code that broke its own settings rolls back to the last good
boot; a 78 on that last good boot ends the next start with 77, and the
supervisor waits for a new delivery. Exit 0 is a stop and 75 a restart after
a land; the full table is in `docs/design/teammate-runtime.md` (*The runtime
contract*). It runs Claude Code as the `claude` on PATH. It builds
the behavior in `behavior/`, shows the agent online in Macro, and waits on its
event sources. A handler decides cheaply what each event needs, and wakes the
agent (Claude Code, with `AGENT.md` and who it is as its system prompt) only
when it is needed.

A run that answers a message only talks. Anything longer the agent hands to
itself (`doLater`) and is woken for on its own. Every wake ends with a commit
of this repository, a pull of its remote's `main` with `--rebase`, and a push.

What a run may spend is capped, per run and per day of its owner, by
`budgetUsdPerRun` and `budgetUsdPerDay` in `agent.json` (5 and 50 USD unless
set). Once a day's runs reach the daily cap nothing wakes until the next day,
and the owner is told once.

Each call the agent is on is a process of its own (`bin/agent joinCall`), so
a call outlives a restart of the agent.

## Operate

    bin/agent list                          # its catalog, one line per capability
    bin/agent describe <name>...            # a capability's docs, or one function's docs and signature
    bin/agent <function> '<json>'           # call a function; bare when it takes no input
    bin/agent exec <file|->                 # run a script exporting async main({ context, log })

    bun run check                           # typecheck and tests

Never start a second `bin/agent run` for the same agent: both would answer
the same messages.

## Layout

    index.ts, cli.ts, bin/agent    build the behavior; run the agent, or call any function
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
      private/<owner>/             committed: people, their messages
      run/<owner>/                 never committed: queues, cursors, locks
      log/<owner>/                 never committed: logs and recordings

## The runtime contract (with the computer's image)

The image's launcher clones this repository into `AGENT_WORKSPACE`, places
`@macro-inc/muppet`, `@macro-inc/sdk`, `@macro-inc/observability` and the
packages `bun.lock` locks in `node_modules`, and runs `bun cli.ts run` as the
agent's service.

| Variable | Required | What it is |
| --- | --- | --- |
| `AGENT_WORKSPACE` | yes | This repository. |
| `MUPPET_CREDENTIALS_FILE` | yes (hosted) | The enrollment's `agent.env`, a systemd credential: `KEY="value"` lines. |
| `MUPPET_CREDENTIALS` | no | `sops` for a self-hosted agent, which keeps `secrets.enc.json` instead. |
| `MUPPET_LAST_GOOD_FILE` | yes (`run`) | Written with HEAD after a healthy boot. |
| `MUPPET_RESTART_FILE` | yes (`run`) | Touched after a land, by whichever process landed; `run` sees it change, stops (a last sync when idle) and exits 75, which its launcher starts again. |
| `MUPPET_MCP_SERVERS_JSON` | no | Stdio MCP servers for every wake (`{name: {command, args?, env?}}`). |
| `CREDENTIALS_DIRECTORY` | set by systemd or the teammate image (`/run/teammate`) | Hidden from Claude Code and scripts with bubblewrap (`bwrap` on PATH). |
| `HARNESSD_STATE_DIRECTORY` | yes (with systemd credentials) | harnessd's Claude sign-in, read-only inside the sandbox; the `claude` wrapper on PATH reads it. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | Where spans go; none means none are exported. |
| `OTEL_EXPORTER_OTLP_HEADERS` | no | Extra export headers (`key=value,…`); the image names the computer (`x-macro-computer-id`), for a per-computer limit at the intake once the id is signed. |
| `MACRO_LAUNCH_TIMINGS` | no | The image's `start-agent` steps, `started:<µs>,<step>:<µs>:<µs>,…,exec:<µs>` (Unix microseconds): `agent.start` begins at `started` and has them as `agent.launch.*`. Malformed is ignored. |
| `MACRO_SETUP_TRACEPARENT` | no | The computer's setup trace (W3C `traceparent`): the agent's start (`agent.start`) and its online report join it. The image exports it for the first start only, from `/run/macrod/agent-traceparent` (which macrod stages), never from `agent.env`. |

`agent.env` holds `MACRO_API_KEY`, `MACRO_GATEWAY`, the `OVERRIDE_*` service
addresses, `MACRO_REPO_URL` and `MACRO_REPO_TOKEN`, and, in Macro-credits
mode, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, which only Claude Code gets.
Without them, Claude Code uses the computer's Claude login (harnessd).
It may also hold `OTEL_EXPORTER_OTLP_ENDPOINT` (the deployment's telemetry
intake), which the image exports as process environment.
`MACRO_SETUP_TRACEPARENT` comes from a file of its own, never agent.env.

On SIGTERM (a unit's stop, `docker stop`) with no wake running, `run`
commits, pulls and pushes once more (`sync: stopping`, at most 40 s) before it
exits 0, so the agent's work follows it to another machine; a wake that is
running is cut off and its work is committed by the next start. A stop
during the start is handled the same way.

An agent's own machine goes offline: Macro being unreachable is not a
failure. The start needs nothing from Macro, and a stream from Macro whose
start fails (asking who the agent is, listening for messages) is tried
again, backing off from 1 s to 60 s, while the agent shows offline. A boot
is healthy (`MUPPET_LAST_GOOD_FILE` written) only once chat hears Macro; an
offline one waits, up and not healthy, with no deadline. Only when Macro
answers and chat's stream still doesn't open within 3 minutes does `run`
exit 1, a failed boot, so code that broke listening rolls back.

Exit codes of `run`: `0` stopped; `75` restart after a land; `78` a setting or
credential is missing or invalid. The launcher (`start-agent`) adds: `78` when
landed code needs a newer muppet than the image's (`muppetApi` above its
`apiLevel`) and last-good would run, so it rolls back; and `79` when there
is nothing that would run to roll back to (a new agent, last-good itself, or a
last-good that needs more too), which the service doesn't restart until the
computer boots a newer image. Anything but 0, 75 and 79 before the
healthy-boot marker moves is a failed boot (78 too, unless the boot was
already on the last good HEAD: then the enrollment, not the code, is wrong),
and three in a row roll the workspace back to the last good HEAD, recorded as
a commit so it stays rolled back. Any stop of last-good's code starts the
count again. A lock that differs from the image's is adopted unless the
agent changed `package.json`.
