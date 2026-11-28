# tests/chat-scale

## What it is

Chat's cost at scale in the real app: the built app in Chromium opens Chat
over 3,500 and 7,000 joined channels from one deterministic account, with no
backend, and measures the page's heap after a forced collection, long tasks,
DOM size, and time to the first rows. Loose limits fail it.

## How it works

Each size gets a fresh browser context. `seed` is the earlier visit (the
channel lane's whole pass into an empty cache), `coldOpen` the next load over
that cache, then one message pushed over the socket, twenty pages of scroll,
and Direct messages collapsed and expanded. After each step settles (no
request for 3 s) the spec collects garbage through CDP and reads the heap,
DOM, long tasks and requests since the step began.

## Start here

- `chat-scale.spec.ts`: the steps and what each records.
- `fixture.ts`: the account (about 75 participants a channel, sections,
  favorites, notifications) and the Soup resolvers that serve it, paging as
  the server does. 2N is N plus older eras of channels (`ERA_CHANNELS`) that
  no first page shows.
- `backend.ts`: every request the page makes, answered in the test process:
  Soup GraphQL (HTTP and `graphql-transport-ws`) from the fixture's
  resolvers, channel sections, `REST_ANSWERS` for the services Chat's shell
  reads, and the bundle's files.
- `limits.ts`: the ceilings and N to 2N growth limits, with the local
  measurements they were set from.

## Checks

From `apps/web`:

- `just build-chat-scale`, then `just test-chat-scale-browser` (about four
  minutes; `-g 3500` runs one size, which checks only its ceilings). It
  writes `.cache/chat-scale/results.json`, `summary.md` and Playwright's
  report; a failed size leaves its requests and console errors in
  `test-results/`.
- `bun run test tests/chat-scale` for the limits' own rules and the
  fixture's paging and filters.
- CI: the `Chat scale` workflow (`chat_scale.yml`), nightly and by hand; it
  uploads `.cache/chat-scale` and tells Macro Alerts when it turns red.

## Changing a limit

Limits sit two to four times above a local run, so a shared CI machine passes
them. Raise one only with the measurement that needs it, and record the new
local numbers in the comment above `CEILINGS`; lower one when a change cuts
the cost it bounds.

## Gotchas

- A request nothing answers fails the run (`backendErrors`): add the route to
  `REST_ANSWERS`, or to `NOT_FOUND` when the app handles a 404.
- A GraphQL field the fixture does not resolve gets an empty value for its
  type and is counted in `requests.defaulted`; a non-null field left `null`
  would fail the whole query.
- The viewer has no team: the CRM access hint must be `none` or a UUID policy,
  and `/auth/team` answers 404.
- Request counts per step include the app's periodic polls, so they are
  recorded, not limited.
