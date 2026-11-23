# apps/web/tests/channels-e2e

## What it is

The end-to-end suite for channels (team chat): the built web app in Chromium
against a whole local stack, with four seeded people for each parallel worker,
in separate browser profiles. [README.md](README.md) has how to run and extend it.

## Start here

- `harness/fixtures.ts`: the fixtures every test gets.
- `harness/channel.ts`: the page object for an open channel.
- `ledger/inventory.tsv`: what channels do and which tests cover it.
- `fuzz/README.md`: the differential fuzzer, which runs random sequences of
  operations against the builds with and without `VITE_ENABLE_CHANNEL_LOCAL_SYNC`
  and compares them.

## Scope

- Owns: what a person sees and does in channels, across two or more people.
- Not here: unit and component tests of channel code → beside that code in
  `apps/web/src/features/channel`.

## Checks

- `cd apps/web && just test-channels-e2e <instance>` against a running stack
  seeded with `seed/scenarios/channels-e2e.json`.
- `bun tests/channels-e2e/ledger/check.ts` after adding, renaming or removing
  a test.
- CI: `Channels end-to-end` (`channels_e2e.yml`), on pushes to `main`, nightly
  and by hand; not part of `PR CI`.

## Gotchas

- Assert only what is on screen. A test that reads a request, a cache or app
  state stops holding when message storage or sync changes, which is what the
  suite exists to check.
- The message list is virtualised: rows outside the window are not in the
  DOM, and a row is drawn a moment before its text.
- Never write a person's email address or id in a test: each worker has
  people of its own, so take them from the `people` fixture.
- A row left by an earlier run (a direct message lasts for the life of the
  stack) can make an assertion pass that fails for a new account; check that
  a test passes for a cast that has never run it.
- Posting hundreds of messages while tests run stalls every open page of
  their authors; make bulk history in `harness/history.ts`, before the run.
- The mark on a link's target message lasts one second and toasts are
  transient: observe them before waiting on anything slow.
- A test for a known defect is `knownDefect(...)` (from the fixtures) plus a
  row in `ledger/known-defects.tsv`, never a weakened assertion; both name the
  builds that have the defect, with or without `VITE_ENABLE_CHANNEL_LOCAL_SYNC`. A defect that shows
  only sometimes cannot be marked that way: wrap its check in `failsSometimes`
  and list the test in `ledger/intermittent-defects.tsv`.
- ArrowUp from the composer can lose the keyboard to the composer again on a
  busy page (KEY-05): a test about something else reaches the message list
  with Escape.
- A defect that shows on one machine in every run and on another in none
  (a list read again before a write is in it: CHN-02, ACC-06, CHN-08, DM-01,
  DM-03, MEM-03) is
  intermittent, not known: CI and a developer's stack disagree about it.
- Global setup empties each cast's favorite channels: the sidebar draws only
  the rows near its window, so leftovers push a new row out of the page.
- A message sent, or a reaction changed, in the first second after a page
  loads may not be sent on a build that queues writes on the device: a test
  that is not about that waits for the other person's page to show it before
  reloading.
- A channel opened once and left at once may not be on the device yet (OFF-09):
  a test about something else that needs it held offline gets it there with
  `readAndReturn` from `harness/device.ts`.
- A page cut off in its first seconds is still fetching code: it then says a
  new version is out (REC-04), may not open a held channel and can take the
  keyboard from the composer. `goOffline` waits for the code first;
  `goOfflineAtOnce` is for a test of that moment, or one that has waited
  with `codeFetched` already (OFF-02).
- While `goOffline` waits, the device is connected and left alone, so it
  also brings its recent channels up to date: a test of what a device holds
  with no such pause (OFF-09, OFF-10, SYN-05) cannot be told from REC-04
  until that defect is gone.
- Left alone for a few seconds, a device fetches a channel with something
  unread in it (PRE-01): a test that needs a channel the device has never
  held makes it and loses the connection with no wait between (OFF-02).
- Typing in a window that is not in front goes nowhere: with two windows of
  one profile, `bringToFront()` the one about to be typed in.
- Run `just build-cache-wasm` before building a bundle to test: `bun run build`
  does not rebuild the cache engine and `just ensure-cache-wasm` only does on
  a crate version bump; an engine older than the web code left a reloaded
  page's writes waiting five minutes (WRT-04).
- With the flag, messages are read through `src/lib/queries/messages/local/`:
  a break of the fetch or the insert in `messages/timeline.ts`, or of the
  live events' own handling, can leave a test passing there, so a test of
  opening, order, links or live events is watched failing on a build with
  the flag too.
- `haveViewed` leaves a person's notifications unseen, and a device fetches
  channels with unseen ones: a channel meant to be read has only the
  person's own messages (PRE-03).
- A link in a message opens a new tab, which cannot load offline: offline,
  a link is followed again with Back (OFF-12).
- `page.clock` moves a device's clock (PRE-05); the services keep the real
  time, so only what the device itself dates moves with it.
- `blockWrites` and `loseWriteAnswers` match the four message mutations by
  name; a broader match also stops the read-marker writes a page makes.
- Every run leaves its channels on the stack, and a page reads its whole
  list of channels, a hundred to a request, after every load: a cast that has
  run the suite some forty times reads for seconds. A rename saved meanwhile
  never reaches the header (CHN-16), so a test that renames in the app waits
  with `channelListRead` first (CHN-03). Check a test that started failing on
  an old stack against a cast that has run little (`CHANNELS_E2E_FIRST_CAST`).
- Every run also leaves each person some thousands of notifications, and on
  some builds a page read the person's whole feed of them again on every
  mark-seen and every push: at 20,000 a page spent its time on that and its
  writes were minutes late. Global setup removes the casts' notifications
  (`clearNotifications`), so a run starts with few (one still on its way from
  an earlier run can arrive after); a finding that shows only late in a long
  run may still be that load.
- The Invite dialog's one row reads "Invite <address>" until the device's own
  list of people answers, then becomes that person's row, sometimes under the
  click: find the row by the address (`inviteByEmail`), not by that name.
- Give each run a run directory of its own: a run that finds an earlier
  run's `history` channel in its directory reads one that old, behind every
  channel made since (OFF-13 is the test of a held channel that old).
- A new page takes a second or two to start keeping channels, and under load
  more. `holdDeviceBack` makes that moment last: the page reads from the
  services and keeps nothing until it is let go (OFF-14). A device fetches
  recent channels by itself but not their threads, so only a thread tells
  what a lost page left behind from what the next page fetched anyway.
  Nothing on screen says when the next page has kept it: OFF-14 relies on
  the pause `goOffline` makes, which held 30 of 30 at a load of 30 to 50.
  what happens the first time (DM-02) shows once for each cast on a new
  stack and seldom on an old one: watch such a thing on a new stack.
  stack and never on an old one: prove such a thing on a new stack.
- Channels are kept on the device only by a build with
  `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true`, which has no default; without it
  channel messages go over REST. That flag alone tells the suite's two builds
  apart, and CI runs both.
- Chromium with no network interface but loopback (a bare network namespace)
  counts itself offline from the start: `navigator.onLine` is false and no
  `offline` or `online` event ever fires, so the app never learns that a test
  cut its connection. Global setup refuses to run there; give the namespace
  an interface with an address. A default route is not needed, and one to a
  gateway that never answers makes requests to outside hosts take three
  seconds to fail.
- An unread refresh in the background waits while `navigator.onLine` is false,
  so on such a runner a mention never got its count (UNR-05 was listed as a
  known defect for that reason alone). Suspect the runner first when a defect
  shows on both builds and only here.
- The fuzzer's models are what a browser that knows its connection does: a
  write made with no connection is held on both builds, over REST by the page
  it was made in and not by the person's other window. Change
  a model only from behaviour seen where `checkBrowserSeesConnection` passes.
