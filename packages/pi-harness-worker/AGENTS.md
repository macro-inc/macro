# pi-harness-worker

## What it is

An offline proof of the Pi headless session API against the starter-agent
Brain prompt and attempt fixtures. It has its own manifest and lockfile.

## Start here

- `worker.ts` opens the in-memory Pi session with the fake provider and one tool.
- `parent-fixture.ts` grants one synthetic record and fences its fake dispatch.
- `offline.test.ts` exercises the completed turn and cancellation.

## Boundaries

- The runner imports the reviewed composer source and its shared fixture for
  the tests. No hosted package imports this proof.
- Keep the test provider in memory and the child a single local fixture.
- Keep production tool authorization, recovery, and runtime packaging outside
  this proof.

## Checks

- Run `bun install --frozen-lockfile --ignore-scripts` and `bun run check` in
  this directory. See [README.md](README.md) for the separate Linux trace.
