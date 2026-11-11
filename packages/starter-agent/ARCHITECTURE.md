# How the agent is built

The agent is Claude, woken by events, built on the muppet library
(`@macro-inc/muppet`, in `node_modules`). `AGENT.md` is its
charter; this file is how the code is laid out and the rules it keeps.

Never modify muppet. Read it; write only here.

## The shape

Muppet's `DESIGN.md` (in `~/muppet`) is the model: behavior is declarative
TypeScript, state is data, and the two never mix.

```
index.ts                       builds the real context, the agent and the behavior
cli.ts, bin/agent              run the agent, or call any function from a shell
agent.json                     who it is in Macro, who owns it, the name it commits under
AGENT.md                       the charter: every run's system prompt
secrets.enc.json, .sops.yaml   credentials, encrypted with SOPS (age)
behavior/
  index.ts                     the whole behavior, composed from the areas
  context/                     the one place IO happens: disk, clock, shell, credentials, Macro
  agent/                       the agent as Claude Code (Agent SDK), its limits per event, its guards
  events/sources/<area>.ts     where events come from
  events/handlers/<area>.ts    what happens when one fires
  capabilities/<area>/     what the agent can do, and all of the area's logic
state/
  memory/<owner>/              committed: what the agent knows, and its durable records
  private/<owner>/             never committed: people, their messages, mail, screenshots
  run/<owner>/                 never committed: queues, cursors, locks, per-run records
  log/<owner>/                 never committed: logs and recordings
```

`chat` is the worked example of an area. Read these before writing another:
`behavior/capabilities/chat/*`, `behavior/events/sources/chat.ts`,
`behavior/events/handlers/chat.ts`, `behavior/index.ts`, `behavior/context/*`.

## An area

An area is four things, each a muppet behavior fragment, wired together once
in `behavior/index.ts`:

1. **Context** — `capabilities/<area>/context.ts` exports
   `<area>Context(base: Base)`, which returns `behavior<Base>().decorate({...})`
   with the area's ports and in-memory state, and the type
   `<Area>Context = ContextOf<ReturnType<typeof <area>Context>>`. It is called
   exactly once, so its values are shared by everything in the process.
2. **Capabilities** — `capabilities/<area>/index.ts` exports the area's
   functions, ordinary typed functions of the context and one input object;
   one `module({ name, summary, docs, file: import.meta.path, functions })`
   that lists them; and
   `<area>Capabilities = behavior<<Area>Context>().capability(<module>)`.
   A function's doc comment and its types are its documentation: `describe`
   reads both from the code. There are no input or output schemas. `tasks`
   is the worked example of this part.
3. **Sources** — `events/sources/<area>.ts` exports
   `<area>Sources(context)`, returning `behavior().source({...})`. Sources are
   lazy: nothing connects, polls or spawns until the source is first read, so
   building the behavior (which `bin/agent <capability>` does) starts nothing.
4. **Handlers** — `events/handlers/<area>.ts` exports
   `<area>Handlers(sources)`, returning
   `behavior<<Area>Context>().use(sources).on(...)`.

A handler decides cheaply and wakes the agent (`context.wake(request)`) only when
it is needed. The agent then acts through code mode: it writes a script that
imports the functions it needs and calls them with `context`, inside this
process. Anything outside the process (a call's brain, a person at a shell) calls the same functions with `bin/agent <name> '<json>'`,
or runs a script with `bin/agent exec`. So **anything the agent can be asked to do is
a function of a capability**: it can be run by hand, read in a log, and
scheduled.

**Every script is type-checked before it runs**, against this repository's
own code, by a TypeScript language service kept for the life of the process
(`index.ts`). One that doesn't type-check is never written or run; the
compiler's errors come back instead. `bin/agent <name> '<json>'` is a one-line
script with the JSON written into it, so it is checked the same way: a
mistyped flag, or input the function doesn't take, never reaches the
function. The type checker is the only thing that checks a function's input,
so a rule a type can't state (a string that mustn't be empty, a number that
must be positive, a name that mustn't be a flag) is checked inside the
function, with a plain check that throws a clear error. A capability
function never parses its own input with zod; zod is for data another program
produced (a hook's JSON, a file read back, an API's reply). A test calls
a function the way the command line does with `invoke` from `test/invoke.ts`.

Areas talk through events and the context, not imports of each other's
internals:

- **Hooks.** `sources.hooks.preWake` adds to a wake's system prompt (people
  cards, who the agent is, the tasks it has handed itself); `postReply` and `failed` (one hook, told apart by `kind`) react
  after. A hook handler reads `wake.event.name` and parses
  `wake.event.payload` with the owning area's zod schema to decide if the
  wake concerns it.
- **Sources another area pushes to**, e.g. chat's `unanswered`.
- **Schedules.** Anything on a clock is a schedule (`@macro-inc/muppet/utilities/schedules`,
  already wired): a handler on `sources.schedules` acts on the firing's
  `name`. Declare a standing schedule by ensuring it exists at startup
  (see lib's `examples/heartbeat/index.ts`), never by a timer of your own.
- **Per-event limits.** A wake's budget and time limit come from
  `behavior/agent/profile.ts`, by source name.

Long-lived children (a call's voice session, the share browser) are processes the agent starts through `shell.start`, running
`bin/agent <capability>`; they are recorded in `state/run/<owner>/` so a
restart can find them.

## Rules (from muppet's STYLE.md, and the agent's own lessons)

- **Use the type system fully. No type casts**: no `as X`, no `as unknown as`,
  no `!`, no `any`. (`as const` is fine.) Data from outside (JSON files, SDK
  payloads the types don't cover, process output, model output) is parsed
  with zod at the boundary. What a script or `bin/agent` passes a function is
  not such a boundary: the compiler has checked it. If the SDK's types are wrong, parse `unknown`.
- **Pure functions; no IO outside the context.** A function never reads the
  clock, disk, network, environment or `process` on its own: it is given a
  `Clock`, `Disk`, `Shell`, `Credentials`, `Macro`, or a port you define, through
  the context. The only modules that import `node:*`, `Bun.*`, an SDK client
  constructor, or touch `process` are `behavior/context/*`, an area's
  `context.ts` (where its real ports are built), `index.ts` and `cli.ts`.
- **Never refer to a path by anything other than a variable.** No path
  literals inline. State paths come from `state.memory(owner)`, `.private`,
  `.run`, `.log`, `.sharedFile(name)` joined with named constants; settings
  that are places or ids live in `behavior/context/config.ts` or the area's
  own `config.ts`.
- **No classes.** Objects of functions, made by a function that takes its
  dependencies.
- **The decision is pure; the IO is thin.** The part that decides takes facts
  and returns actions, and is where the tests are. Tests sit in
  `capabilities/<area>/test/*.test.ts`, use `bun:test`, never touch the
  network, and never sleep: time is a `Clock` you move.
- **Time goes through Temporal** (`@macro-inc/muppet/utilities/time`; Bun has
  `Temporal` built in, with types from `temporal-spec`). No `Date`, no epoch
  arithmetic, no comparing ISO strings.
- **Secrets come from `credentials.get(name)`** and go no further: never
  printed, logged, written to state, or put in a process's arguments. A child
  process gets one through `env`. New secrets are stored with
  `credentials.set`.
- **State by bucket.** Choose the bucket by what the data is; anything about
  a person or from a person is `private`. One writer per file. Whole-file
  writes go through `disk.write` (atomic).
- **A system that runs on its own needs a log you can read back**:
  `log.event(stream, entry)`, and a capability that reports on it.
- **The agent's git identity is its environment** (`base.environment()`), never git
  config. Children that run git or gh get it through `env`.
- **Comments say why**, in plain sentences, like the surrounding code. Format
  like the surrounding code: two spaces, single quotes.

## Commands

```sh
bun install                                   # once per checkout or worktree
bunx tsc --noEmit -p .                        # typecheck
bun test                                      # tests
bin/agent list                                # the catalog
bin/agent <function> '<json>'
```

Don't start `bin/agent run` beside a running agent: both would answer the
same messages. Live tests message or call the owner and nobody else; keep
them few and say they are tests.
