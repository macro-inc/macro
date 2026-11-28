# channels-view/cache-harness

## What it is

Chat's sidebar data path at 3,500 and 7,000 joined channels, measured over the
real cache engine with no browser: the production query layer, data hooks,
channel directory and Soup client against a seeded cache, counting the work
each scenario does so it can be compared at N and 2N, and failing PR CI when
that work grows.

## How it works

`chat.harness.tsx` runs `run-scale.tsx` twice per size, each time in a fresh
module graph: `seedChatCache` is the earlier visit (the channel backfill lane
and one open of Chat), `measureChat` the next page load over the same cache
files. That load counts, per scenario: the app shell's directory, opening
Chat, one unrelated cache write, one message in one channel, and a section
expanded then collapsed. `gate.ts` then compares the counts with
`baseline.json`.

The fixture comes in eras of 3,500 channels (`ERA_CHANNELS`): 2N is N plus an
older tail no first page shows, so a count that differs between the two sizes
grows with the account, not with what is on screen.

## Start here

- `fixture.ts`: the deterministic account (about 75 participants a channel)
  and the GraphQL resolvers that serve it, counting rows asked and returned.
- `mount.tsx`: `ChatDataPathMount`, the `ChannelsRail` composition without its
  rendering, and `modelViewport`, the rows a fixed 816px sidebar mounts. A
  section's visible range comes from `onSectionRange`; `ChatDataPath.viewport()`
  reads it back.
- `run-scale.tsx`: the scenarios and what each one records (`ScenarioCounts`).
- `chat.harness.tsx`: the module mocks that point the app at the harness and
  count its mappers.
- `gate.ts`: the counts that fail a run, their limits and the visible-window
  caps.

## Counts

Per scenario, each its own number:

- `engine`: every call into cache-wasm, by method; the records they returned;
  `views`, reads per view (a query and its variables, a filter, a search), so
  `repeats` is how many reads read a view again within the step.
- `sql`: statements the engine ran and rows they stepped; `opfs`: file I/O.
- `network` and `server`: operations sent, and the rows the fixture server was
  asked for and returned.
- `mappers`: `calls` to each counted mapper, `built` (results not returned
  before, so a memoized answer is not work), `trackedWalks` (calls inside a
  tracking scope over a store proxy, each field read making a store node,
  FE-70), and `rows` (distinct rows mapped).
- `solid`: owners, signals and store nodes created, also per resolved row.
- `rows`: rows the rail built, resolved to a channel, and mounted.

## Gate

`gate.ts` fails the run on:

- Drift: any gated count more than 5% (or 5) away from `baseline.json`, up or
  down. Less work fails too, so the baseline records the win and the next
  change is measured against it.
- Growth: a count at 2N over 2.2 times its count at N (counts under 10 at N
  compare as 10).
- Visible-window caps (`WINDOW_CAPS`): work that should follow the screen,
  capped at main's count plus about 10% at both sizes. A baseline update never
  moves a cap; change a cap only by hand, and lower it when a change lowers the
  count.

When a change is meant to move the counts, run `just test-cache-harness-update`
from `apps/web` and commit `baseline.json` in the same change, with the reason
in the PR. Reviewers read its diff as the change's cost.

## Checks

- From `apps/web`: `just test-cache-harness` (all headless harnesses, about
  four minutes, half of it building the engine) or
  `just test-cache-harness src/features/channels-view/cache-harness`. It writes
  every count to `.cache/chat-cache-harness/results.json` (or
  `CHAT_CACHE_HARNESS_OUT`) before it checks the run.
- `bun run test src/features/channels-view/cache-harness/gate.test.ts` for the
  gate's own rules.
- PR CI runs `just test-cache-harness` as the web checks' **Cache Harness** job.

## Gotchas

- A run fails before the gate if any request left the process, the fixture saw
  a filter it cannot serve, the network logged an error, or an engine call
  failed (`engineErrors`): a filter shape the fixture cannot serve is a fault,
  not an empty answer, so add it to `fixture.ts`.
- Expand and collapse toggle Direct messages (`TOGGLED_SECTION`), whose rows
  are on screen when Chat opens; the run fails if that section is not, since
  a viewer can only click a heading they see.
- A step has settled once nothing moved for `QUIET_MS`, longer than the
  channel directory's 2 s refresh spacing; a shorter wait lets the refresh a
  step caused land in the next step's counts.
- The app reaches the harness only through `harness-state.ts`, on
  `globalThis`: each load is a new module graph, and the mocks of both graphs
  must read the same state.
- Mapper counts are calls from other modules (see the headless `AGENTS.md`); a
  new mapper is counted by adding it to the mocks in `chat.harness.tsx`.

## Related

- Engine harness: `src/lib/graphql-cache/headless/AGENTS.md`
