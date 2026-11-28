# tests/chat-scale

## What it is

Chat's cost at scale in the real app: the built app in Chromium opens Chat
over 3,500 and 7,000 joined channels from one deterministic account, with no
backend, and measures the page's heap after a forced collection, long tasks,
DOM size, and time to the first rows. Loose limits fail it.

## How it works

Each size gets a fresh browser context. `seed` is the earlier visit (the
channel lane's whole pass into an empty cache), `coldOpen` the next load over
that cache through the lane's refresh pass, then one message pushed over the
socket, up to twenty pages of scroll (the rail's rows run out after about
eight), and Direct messages collapsed and expanded. After each step settles
(nothing in flight and nothing moving for 3 s) the spec takes the requests
and the rows the step asked the server for and got back (Soup reads and
channel previews), then the long tasks, DOM and the conversation rows the
rail mounted, then collects garbage through CDP and reads the heap.

Each step also checks that it did what it is named for, and the run fails
when it did not: the seed finished the channel pass into the browser cache,
the next load reopened that cache (the lane checkpoint's storage generation)
and finished a refresh pass of its own (a later completion time), a direct
message far down its section, not among the rail's top rows before
the message, is among them after it; the rail scrolled five pages (or to its
end) and mounted rows the top did not show on the way down; and collapsing
Direct messages hid conversations it showed, which expanding brought back.
After the steps, every section's heading must have shown, open or closed
as the viewer saved it. `results.json` keeps this as `evidence`, with the
sections' coverage.

## Start here

- `chat-scale.spec.ts`: the steps and what each records.
- `fixture.ts`: the account (about 75 participants a channel, sections,
  favorites, notifications) and the Soup resolvers that serve it, paging as
  the server does. 2N is N plus older eras of channels (`ERA_CHANNELS`) that
  no first page shows. Sections grow with the account: six team sections
  and three personal ones hold about 92% of the channels that can be in a
  section (every channel but direct messages), from every era, and a fourth
  personal section is a name rule over the private channels. Six of the 12
  favorites are old. `savedView` is the viewer's saved rail: Favorites,
  Direct messages and one team section open, everything else collapsed.
- `backend.ts`: every request the page makes, answered in the test process:
  Soup GraphQL (HTTP and `graphql-transport-ws`) from the fixture's
  resolvers, channel sections, `REST_ANSWERS` for the services Chat's shell
  reads, and the bundle's files.
- `limits.ts`: the ceilings and N to 2N growth limits, with the local
  measurements they were set from.

## Checks

From `apps/web`:

- `just build-chat-scale`, then `just test-chat-scale-browser` (about four
  minutes; `-g 3500` runs one size and the limits test over it, which checks
  only that size's floors and ceilings). It
  writes `.cache/chat-scale/results.json`, `summary.md` and Playwright's
  report; a failed size leaves its requests and console errors in
  `test-results/`.
- `bun run test tests/chat-scale` for the limits' own rules and the
  fixture's paging and filters.
- CI: the `Chat scale` workflow (`chat_scale.yml`), nightly and by hand; it
  uploads `.cache/chat-scale` and tells Macro Alerts when it turns red.

## Changing a limit

Ceilings sit two to three times above two local runs on a busy shared
machine, so a CI machine passes them. The heap and long-task growth limits
allow the growth Chat has today, because the sidebar's work follows every
channel its sections and favorites name; lower them as that work is bounded
by the screen. Raise a limit only with the measurement that needs it, and
record the new local numbers in the comments above `CEILINGS` and `GROWTH`;
lower one when a change cuts the cost it bounds. `FLOORS` are the least a measured step can read; a
reading under one is a measurement that did not happen.

## Gotchas

- A service request nothing answers (a 501), a GraphQL error and a read the
  fixture cannot serve each fail the run (`backendErrors`): add the route to
  `REST_ANSWERS` in its service's response type (`NOT_FOUND` when the app
  handles a 404, `NO_CONTENT` for a 204), or the read to the fixture.
- `quiet` fails a step that never pauses for 3 s within two minutes, rather
  than measuring it mid-flight.
- A GraphQL field the fixture does not resolve gets an empty value for its
  type and is counted in `requests.defaulted`; a non-null field left `null`
  would fail the whole query.
- The viewer is the only member of its team (`TEAM_ID`), which owns the team
  channels and sections, and has no CRM access: the CRM access hint must be
  `none` or a UUID policy.
- Request counts per step include the app's periodic polls, so they are
  recorded, not limited.
- The rail pages its sections in as it scrolls, so it has no bottom to find,
  and the rows at its deepest point can still be skeletons: the scroll counts
  the rows mounted on the way down. A row far down a section is not in the DOM
  at all, which is why the message goes to a direct message deep in its
  section and is checked at the top of the rail.
- A collapsed section keeps its unread and mentioned conversations listed, so
  the collapse checks the conversations that went away, not the row count.
- Before it opens a browser the run checks the fixture still has the shape
  that makes the rail's by-ID reads grow with the account: sections hold at
  least `MIN_SECTION_COVERAGE` of the channels that can be in one, and at
  least `MIN_OUTSIDE_FIRST_PAGES` of the channels sections and favorites
  name are outside the first page of each list. A fixed handful of sections
  hides that growth.
- The saved view is written to local storage before the app starts, under
  the viewer's key, only when nothing is there yet.
- The rail virtualizes sections at estimated heights: one jump to its end
  lands short once they are measured, so the headings check jumps until the
  end holds (the scroll height steady for a few frames), then pages up,
  and starts over from the end while a heading is missing.
