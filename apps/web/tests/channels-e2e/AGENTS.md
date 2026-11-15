# apps/web/tests/channels-e2e

## What it is

The end-to-end suite for channels (team chat): the built web app in Chromium
against a whole local stack, with four seeded people in separate browser
profiles. [README.md](README.md) has how to run and extend it.

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
- Posting hundreds of messages while tests run stalls every open page of
  their authors; make bulk history in `harness/history.ts`, before the run.
- The mark on a link's target message lasts one second and toasts are
  transient: observe them before waiting on anything slow.
- A test for a known defect is `test.fail()` plus a row in
  `ledger/known-defects.tsv`, never a weakened assertion.
