# Coverage ledger of the email UI

What "the email UI is covered" means, measured: a manifest of everything a
user can do and see in the web app's email surfaces, and the evidence the
browser suite records while it runs.

```sh
just apps/web/test-email-e2e-browser        # the run records the evidence
just apps/web/email-e2e-ledger              # the report, from the last run
just apps/web/email-e2e-ledger --enforce    # ... and fail on what is not covered
```

The report is written to `../ledger-results/report/`: `index.html`,
`summary.md` (the CI job summary) and `ledger.json`. In CI it is the
`email-e2e-browser-coverage` artifact of the `Email end-to-end (browser)` job.

## What is counted

| Ledger | Total comes from | A row is covered when |
| --- | --- | --- |
| Actions | `manifest/<group>.ts`, `actions` | a test called `did('<id>')` where it performs it |
| States | `manifest/<group>.ts`, `states` | a test called `saw('<id>')` where it asserts it |
| Network operations | `manifest/network.ts` | the app made the request and a real service answered without an error |
| Lines | the bundle's source maps | code of the line ran in the browser |

Only a result that passed counts, in a test that is not skipped and not
tagged `@known-bug`. Each piece of evidence carries the provider of the
test's mailbox and its layout (`phone` under 640 px wide, the app's own rule,
else `desktop`).

A row's status:

- **covered**: seen on every provider and on every layout it applies to (each
  provider once and each layout once, not every pairing);
- **partial**: seen, but not on all of them; the report says what is missing;
- **open**: never seen, and the suite could drive it;
- **deferred**: never seen, and it has `needs`: a service or a clock the
  per-test stack does not have. These wait for the full-stack tier;
- **waived**: never seen, and it has a `waiver` with a reason.

The report only reports. `--enforce` (or `EMAIL_E2E_LEDGER_ENFORCE=1`) makes
it fail when a row is open or partial, an email network operation is not
covered, or the manifest differs from the source.

## Marking a test

```ts
import { did, saw } from './ledger/record';

await page.getByText('Reply...').click();
did('AL-171');                        // the action, where it is performed
await expect(page.getByText('Sending…')).toBeVisible();
saw('STC-067');                       // the state, where it is asserted
```

- Call it on the line that does or asserts the thing, so that a test which
  fails before it does not count. A helper in `harness/` that performs an
  action calls `did` itself.
- An id that is not in the manifest throws, and fails to type-check.
- Mark what the test does as a user. A state set up through the API or the
  emulator is not an action; a request the test makes itself
  (`mailbox.api`) is not the app's and is left out of the network evidence.
- Requests and lines need no marking.

## The manifest

`manifest/` has one file per group of surfaces (`list`, `thread`, `organise`,
`saved-views`, `compose`, `send`, `settings`, `elsewhere`), each with its
surfaces, actions and states, and `network.ts`. Field by field: `types.ts`.

- Ids are stable: never renumber, never reuse. A new row takes the next
  number of its prefix (`AL`, `AC`, `AX` actions; `STL`, `STC`, `STX` states;
  `SL`, `SC`, `SX` surfaces).
- `providers` and `viewports` say where a row exists; left out, it exists on
  both providers and on the layouts of its surface.
- An action names what the code registers for it in `registered` (a hotkey
  token, or `<file>#<description>`), a toast state names its toasts in
  `toasts` (`<file>#<text>`): `bun tests/email-e2e/ledger/derive.ts hotkeys`
  and `... toasts` print the names.
- New UI gets its rows in the same change, with a test or a `waiver`.

## What is checked against the source

`derive.ts` reads these off the code, and the report lists every difference
under "Manifest against the source":

- every operation in the GraphQL documents and every call of the email
  service's client is in `manifest/network.ts`, and nothing else is;
- every hotkey the email code registers and every email hotkey token is on an
  action row;
- every toast the email code raises is on a state row;
- every source file a row names exists, ids are unique, rows are on a surface
  of their group.

Requests the app made that the manifest does not list are reported too.

## Lines

`record.ts` turns on Chromium's JavaScript coverage for the test's page and
keeps, per worker, which characters of each script ran in tests that passed.
`lines.ts` maps them through the bundle's source maps: a line counts when the
bundle has code for it, and ran when any of that code ran.

- The email source is the directories in `derive.ts` (`EMAIL_SOURCE`); files
  elsewhere that a manifest row names are reported apart.
- Code that runs in a worker, and pages a test opens beside its own, are not
  seen. A file with no line in the bundle holds only types or is unreachable.
- `EMAIL_E2E_LINE_COVERAGE=0` turns it off for a run.
