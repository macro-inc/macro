# The library (`/lib`)

The libraries primary goal is to help the agent maintain order in its operations.

The libraries two sub goals are to

1. provide the mechanisms that make the system below work
2. provide a set of opinionated utilities that will make it easy for the agent to do hard things.

As a meta goal, the library itself should be highly organized, extensible, and cleanly separated into domains which each define interface and implementation separately.

The library will be totally stateless. It will be context injected so that it may deterministically write to the correct places in state without depending on
the layout of the agent or state directories. This will let it serve agents that have layouts that diverge from the opinions described below. It will not contain
any file paths that are not variables. All system dependencies will be described in a nix flake. All JS dependencies in the `package.json`.

The library will be well-typed throughout and follow STYLE.md.

The libraries mechanisms will be extensible via a plugin system. Consumers may register:

- agents
- events

Developers or the agent may write their own plugins or use the plugins that the library provides.

The library will provide implementations of

- agent: we'll provide a claude-code implementation

We'll provide the agent interface and some implementations of the agent interface but users may also define their own.

Utilities will have some different kinds:

- Event Utility: a utility that fires events.
  ex1: a utility that fires an event when an email is received
  ex2: a utility that fires an event when an a token limit is reached
- Lib

We'll provide some pre-built utilities but consumers may also add utilities.
Plugins will be registered by the consumer of the library. In this project that will be at the entrypoint of our agent.

### agent

The agent itself will be defined in the typescript file. Anything implementing the agent interface may be an agent. This will let
us or future developers add implementations for any agent.

### hooks 

we'll provide lots of event hooks. This will include:

- pre-wake
- post-reply
- post-state-update

These are hooks for events within this system not for things like email.
Hooks will fire as events

### Schedules

We've already mostly written this. This will also fire as an event.

## Utilities

### Date / time 

Small/opinionated wrapper around Temporal

### Credential Management

This is a good example of separation of interface and implementation. This utility will have a single interface but
may have many implementations. To start we will use a SOPS implementation, but may soon add a Doppler implementation.

# The agent (`/agent`)

The agent package depends on lib. In the future lib will be an npm package so the
agent may not modify lib.

## `behavior/`

Behavior is defined by code that the agent will write for itself in typescript.
Behavior is declarative.
Behavior does not hold state or data.

### `behavior/events/`

Events may either be schedule driven or externally driven.
The library will provide the mechanisms to define both schedule and external events.

Events are split into sources and handlers.

#### `behavior/events/sources/`

Sources are where events come from. This directory instantiates and exports every source the agent
listens to. A source may be one the library (or a plugin) provides, which the agent simply instantiates,
or one the agent writes for itself, which it defines using the library's mechanisms, then instantiates
and exports. Handlers never instantiate their own sources; they import them from here.

#### `behavior/events/handlers/`

Handlers decide what happens when an event fires. Many handlers may handle a single source; the library
makes sure each source is only started once (e.g. one connection to an external server) however many
handlers listen to it.

The handlers package will depend on the sources and capabilities packages.

Events may trigger capabilities or wake the agent.

Events may also be used with capabilities to selectively wake the agent using more cost effective models.
Example:
A user wants their agent to respond to important email. An event is added that will fire on incoming mail
this event calls the `respond_to_mail` capability which in turn uses an inexpensive decision model to decide if the
mail is important or not. If it is important the capability wakes the agent.

### `behavior/capabilities/`

Capabilities are code that may be executed by an agent or by an event. The agent will execute code
using the command line and may choose to make convenient interface for itself.

Capabilities are written entirely in typescript, including their prompt. Each capability is a
subdirectory of `capabilities/` with an `index.ts` that exports a well-typed object representing the
capability. This object includes the prompt describing the capability and its usage. The structure
of this object is defined by the library.

A self-authored capability is a module of ordinary typed functions. Its object names the module's
file and the functions the agent is meant to use; it holds no schemas. Each function's doc comment
and types are its documentation, read from the code when the agent asks. The agent uses the
functions by writing a script that imports them. Every script is type-checked before it runs, as
the agent's own code is, and one that does not type-check is not run. The type checker is the only
thing that checks what a script passes to a function.

The Agent may write it's own capabilities. Self-authored capabilities may include code that can be
run alongside the prompt.

Capabilities may also be code the agent did not write itself. These are dependency
capabilities. Dependencies may be added either as a dependency of the node project
or to the `flake.nix`.

A dependency capability may include a prompt or wrapper that helps the agent use it
especially if it is going to do the same task repeatedly. This will also exist
as a subdirectory of `capabilities/` with an `index.ts`, though its capability object may contain only a prompt.

A dependency capability may simply be a program that the agent installs and knows it may use.
In this case the agent will simply add the program as a dependency to the `flake.nix` and configure it as-necessary using home-manager.

The agent may also execute code that is not defined in capabilities. In this case the agent should
be careful not to leave a mess in it's own repo / environment. It will use `/tmp` as it's scratchpad
if it needs to use temporary data / files.

Some examples

- An agent is tasked with managing incoming user messages. It may write a
  capability that uses a decision model to classify messages as bugs or feature requests.
- An agent would like to track relationships with teammates using an RPG-style tracker
- An agent is tasked with re-encoding images. It may add FFMPEG as a dependency.

The above above capabilities directory would have this structure

```
/agent 
  /behavior
    /events
      /sources <content not shown>
      /handlers <content not shown>
    /capabilities
      /triage_messages
        index.ts
        call_decision_model.ts
      /encode_image
        index.ts <- this capability's prompt just tells the agent how to re-encode the image. it may also add code to do this in bulk ->
      /relationships
        index.ts
```

## `state/`

State is where all the data lives. This may store records about ongoing work,
databases, images, blobs, or any other kind of data.

### `capabilities/<capability_name>/`

Capabilities that need data will save their data in
this subdirectory under `agent/state/capabilities/<capability_name>/`. This
should only ever be written to using the specific capability named, but it is not
private and may be read by anything.

### `shared/`

Capabilities may also store data in shared data storage `agent/state/shared/`. Shared
storage may be used by any capability. It may also take any form.

## AGENT.md

The AGENT.md file is static core of the agent. It is the base system prompt and root of
all motivation, decision, thought, and personality. It is written when the agent is created.
It should contain an explicit motivation and goal. It should also contain backstory, name, age,
sex and fragments of personality. This file should also store the creator of the agent.

The dynamic behavior and personality of the agent may be derived through behavior, capabilities, and state.

Example (relationship management):
A user may instruct their agent to remember its positive / negative reactions with it's users and to modify
it's behavior towards them. The agent would define an interaction event that triggers a capability. This
capability would take the interaction and file it as state indexed by the user. The agent would create another
event at would fire before it replies to a user. This hook would lookup the agents feelings about this user
and insert the memory into the system prompt.

Example (user memory)
A user may want their agent to remember facts about the users it interacts with. They would instruct their agent
to configure a system that remembers all concrete facts about users ("please remember when people tell you things like
their birthday, age, tone preferences, or anything else they instruct you to remember"). The agent would again recognize
that this is per-user data and would create events for pre-interaction and post-interaction. The agent would create
a user_memory capability that can lookup and insert memories associated with a user. The agent would trigger this
capability's appropriate function on the appropriate event.

Later a user may ask the agent to edit a preexisting memory of that user. The agent would update the capability interface
to support this new feature and use it as a tool call.

# wolf's thoughts

- how are we doing mcp? maybe just fine to let agent handle (claude code does it)
- how do we handle natural language instructions / rules / skills / when to load these things
