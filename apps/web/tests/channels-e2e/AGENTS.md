# apps/web/tests/channels-e2e

## What it is

The end-to-end suite for channels (team chat): the built web app in Chromium
against a whole local stack, with four seeded people for each parallel worker,
in separate browser profiles. [README.md](README.md) has how to run and extend it.

## Start here

- `harness/fixtures.ts`: the fixtures every test gets.
- `harness/channel.ts`: the page object for an open channel.
- `ledger/inventory.tsv`: what channels do and which tests cover it.

## Scope

- Owns: what a person sees and does in channels, across two or more people.
- Not here: unit and component tests of channel code → beside that code in
  `apps/web/src/features/channel`.

## Checks

- `cd apps/web && just test-channels-e2e <instance>` against a running stack
  seeded with `seed/scenarios/channels-e2e.json`.
- `bun tests/channels-e2e/ledger/check.ts` after adding, renaming or removing
  a test.
- CI: `Channels end-to-end` (`channels_e2e.yml`), called by `PR CI`.

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
  builds that have the defect, with or without `VITE_ENABLE_GRAPHQL_SOUP`. A defect that shows
  only sometimes cannot be marked that way: wrap its check in `failsSometimes`
  and list the test in `ledger/intermittent-defects.tsv`.
- ArrowUp from the composer can lose the keyboard to the composer again on a
  busy page (KEY-05): a test about something else reaches the message list
  with Escape.
- A message sent, or a reaction changed, in the first second after a page
  loads may not be sent on a build that queues writes on the device: a test
  that is not about that waits for the other person's page to show it before
  reloading.
