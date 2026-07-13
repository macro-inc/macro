# AI editing

The general idea is that we have a worker that takes an English request for a
document and dispatches agents to produce edits on the document.

We do this by having a Cloudflare worker join the document as a real Loro peer,
make its edits through the same CRDT system everyone else uses, and stream them
out keystroke by keystroke.

## Shared-code boundary

The worker and web app share the Loro collaboration engine, sync-service wire
transport, and WebSocket runtime through `@macro-inc/collaboration`. Browser
authentication and sync HTTP policy stay in `apps/web`; the package accepts an
environment-specific URL resolver instead. The worker is part of the root Bun
workspace, so the collaboration and Lexical packages resolve one dependency
graph in both runtimes.

# Flow

We have a simple hono Cloudflare worker `POST /edit`. The body carries a
user token, a document id, the prompt, and a few config options (`interpret`,
`typingAnimations`, `debug`, and optional per-role model overrides). The handler
swaps the user token for a short-lived document token against the document
service, builds the sync-service WebSocket URL from it, and hands everything to
`runEditSession` (`src/run-edit.ts`).

## Joining the document

`runEditSession` is the main entrypoint that our edit endpoint calls to start an
edit session. At a high level, it:

1. Opens a sync-service WebSocket, speaking the same Bebop wire protocol as the
   browser client.
2. Waits for the initial snapshot, then spins up a `LoroManager` + `SyncEngine`
   around the markdown Loro schema. It uses the same abstractions the frontend
   does.
3. Wires a `WALSyncer` so local commits get pushed back to the server, and
   flushes it before disconnecting. It's memory backed (not IDB).

## The agents

We're using three agents to carry out our edits:

- **Interpreter**: a first pass that figures out what the user "wants" and
  writes out some goals for the supervisor. Having a thinking step helps the
  supervisor make more "correct" edits for what the user wants.
- **Supervisor**: dispatches coding agents to make small mechanical edits, and
  iterates. Decides when we are done and happy.
- **Writer / coder**: generates code that edits the lexical tree. Uses a custom
  abstraction that we turn into edits for our animation framework, which then
  eventually turns into real lexical edits.

A diagram for the animation abstraction flow

```
 model writes JS  →  QuickJS sandbox  →  DocumentEditor  →  DocumentOp[]
                                                                 │
                              ┌──────────────────────────────────┘
                              ▼
                   animate(op)  →  DocumentOpStep[]   (cursor / pause / edit)
                              │
                  runQueue replays each step:
                    pause → sleep   awareness → cursor   edit → Doc.apply
                              │
        Lexical session  ←────┘
                │
            propagate  →  snapshot  →  mirror  →  Loro  →  sync to everyone
```

### DocumentEditor and ops

`DocumentEditor` is a ergonomic chainable surface the model calls. It has a
million simple small methods like `bold`, `convertToHeading`,
`insertTableAfter`, `mentionUser`. As you use it it accumulates all the ops but
doesn't actually do any mutations on the document. As you create new nodes it
hands out "refs" from a pool of random IDs.

Once the AI writes code that acts on a document editor, we run the code with a
blank `DocumentEditor` in a quickjs sandbox in the worker. That code produces an
accumulated vector of all the document operations we want, which we can then run
on the document directly or propagate via an animator.

For animation, each `DocumentOp` kind has exactly one animator that maps to it,
in, and dispatches on the kind to produce a flat list of `DocumentOpStep`s.
There are only three kinds of steps:

- `awareness`: move the cursor or set a selection
- `edit`: apply a real `DocumentOp` to the document
- `pause`: sleep for some time

We have an abstraction called the "executor" that ties together the animation queue and the document editor. It is what actually "plays" everything.

### "Doc"s

`Doc{Writer/Reader}` is an abstraction over the real Lexical `Document`. This makes everything much more testable. It has a minimal-ish (okay not super minimal) interface that's easy to mock and run against real lexical.

We have a big "ai-toolkit" lexical library that has a bunch of utility functions for working with lexical documents that the real lexical impl of the `DocWriter` uses.

It's `apply` runs as a discrete Lexical update, delegating the actual mutation to
the existing `ai-toolkit` `$`-helpers usually resolved by our durable lexical
node ids. It is what turns DocumentOps into actual edits to the lexical document.

## Cursors and peer ids

**The live cursor** is ephemeral. While a writer works, `realAwarenessSource`
encodes its caret/selection as a Loro cursor and broadcasts it over the
ephemeral awareness channel, so the website renders a remote cursor walking
through the text. Each writer draws a name from a pool (`Sam (AI)`, `Alex (AI)`)
and one of a few accent colors; the cursor lingers ~700ms after the writer
finishes, then clears. We have some ugly code that manages resolving a block id
to the `LoroText` that actually owns the characters for this :/

**The peer id** Human peers get random ids from the whole 64b range, and we have
it so that AI commits use a small reserved range in
(`999999999999999000`–`999999999999999999`). This makes AI authorship easy to
detect (`isAiPeer`) which history will be able to use to group together all AI
edits.
