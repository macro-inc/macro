# Coverage ledger of the email UI

What "email is covered" means for the web app, measured: a list of the
functions of email, a manifest of every way to do each of them in the UI and
of what the app then shows, and the evidence the browser suite records while
it runs.

```sh
just apps/web/test-email-e2e-browser        # the run records the evidence
just apps/web/email-e2e-ledger              # the report, from the last run
just apps/web/email-e2e-ledger --enforce    # ... and fail on what lost its test (CI)
just apps/web/email-e2e-ledger --record     # rewrite full-stack-only.tsv from a run of both stacks
```

The report is written to `../ledger-results/report/`: `index.html`,
`summary.md` (the CI job summary) and `ledger.json`. In CI it is the
`email-e2e-browser-coverage` artifact of the `Email end-to-end (browser)
coverage` job and the `email-e2e-full-stack-coverage` artifact of the tier's.

A run split over machines (`EMAIL_E2E_SHARD`, "2/3") writes
`playwright-2.json` instead of `playwright.json`; the report reads every
such file in a run's directory, so the shards' `ledger-results/` laid over
each other are one run.

## Functions

`functions.tsv` lists what a user does with email: draft, send, reply, mark
done, star, label, snooze, search. One row each: `id`, `area`, `function`,
whether it exists on `gmail` and on `outlook`, whether it has a `ui`, and
`result_checked_at`: where its effect shows besides the screen (`provider`,
`service` when the provider sees nothing of it, or `ui` alone).

The backend's coverage maps its entry points to the same ids, which is why
the list is a table and not TypeScript. Functions with `ui` = `no` are the
backend's alone; the report lists them and does not count them.

A function is **covered** when one passing, gating test, on Gmail and one on
Outlook,

1. does it through the UI (`did` on one of its action rows),
2. checks the result on the screen (`saw` on one of its state rows), and
3. checks the result at the provider or in the service (`confirmed`),
   unless the function is checked in the UI alone.

A function the user does nothing for (mail arriving, the unread badge) has
no action row, and is covered by 2 and 3 alone.

Evidence comes from two gating runs: the suite on per-test stacks
(`ledger-results/gating/`) and its full-stack tier
(`ledger-results/full-stack/`, written when `EMAIL_E2E_STACK_PROXY_URL` is
set). The report reads whichever of the two exist, counts them together and
says which it had. A test that runs on both stacks is counted once.

A covered function is **proved** when `proofs.tsv` names the break that was
put into the product for it and made its tests fail (see Proving a test). The
headline counts covered and proved functions; a covered function without a
proof passes, and nothing shows it would catch a regression.

It is **in part** when tests show some of that, **deferred** or **waived**
when every way to do it is, and **open** otherwise.

`limits.tsv` says, for a covered function, what its tests do not prove (a
stand-in that lacks the behaviour, say). The report prints it beside the
function; write a line whenever a test covers less than the function's name
promises.

## Rows

`manifest/<group>.ts` lists, per group of surfaces (`list`, `thread`,
`organise`, `saved-views`, `compose`, `send`, `settings`, `elsewhere`), every
**action** (a button, a menu item, a hotkey, a phone gesture) and every
**state** (what the app shows). Each row names its function(s) in `fn`: the
actions of a function are the ways to do it, its states are how its result,
its progress and its failures show. Field by field: `manifest/types.ts`.

| Ledger | Total comes from | A row is covered when |
| --- | --- | --- |
| Actions | `manifest/<group>.ts`, `actions` | a test called `did('<id>')` where it performs it |
| States | `manifest/<group>.ts`, `states` | a test called `saw('<id>')` where it asserts it |
| Network operations | `manifest/network.ts` | the app made the request and a real service answered without an error |

Only a result that passed counts, in a test that is not skipped and not
tagged `@known-bug`. Each piece of evidence carries the provider of the
test's mailbox and its layout (`phone` under 640 px wide, the app's own rule,
else `desktop`).

A row's status:

- **covered**: seen on every provider and on every layout it applies to (each
  provider once and each layout once, not every pairing);
- **partial**: seen, but not on all of them; the report says what is missing;
- **open**: never seen, and the suite could drive it (its waiver is of the
  kind `backlog`, or it has none and fails the job);
- **deferred**: never seen, and its waiver is of the kind `needs`: a service
  or a clock no stack gives a test yet;
- **waived**: never seen, and its waiver is of another kind.

A tested row is **proved** when `proofs.tsv` names the break that made its
test fail at the row's own assertion. The report counts rows total, tested,
proved and waived by kind beside the same numbers for functions.

## What fails the job

Both CI jobs run the report with `--enforce`: the browser suite's in each run on
`main`, pushed or the daily sweep, the full-stack tier's in the sweep
(`../README.md`, CI). It fails when

- a function on a provider, or a row, has no passing test on its stack and
  no line in `waivers.tsv`: a covered function that lost its test on Gmail
  or on Outlook, and a new row or function that came without a test;
- a passing test covers what `waivers.tsv` waives: remove the line;
- a function waived on no provider has no line in `proofs.tsv`;
- a row without a line in `waivers.tsv` has no line in `proofs.tsv`: a
  new row comes with a test and with the break that made the test fail;
- the tests tagged `@known-bug` were not run (unless the run left them out
  on purpose, `--without-known-bugs`: CI on a push to `main`), or one of
  them passes:
  remove the tag, and the waiver that stood for the bug. A bug that shows only in some runs is also tagged
  `@sometimes`, and a pass of its test fails nothing: one run cannot tell
  that it is gone;
- `waivers.tsv` or `full-stack-only.tsv` names what the manifest lacks, or
  the manifest differs from the source.

Network operations are reported and never fail it. A row seen on one of its
providers or layouts counts as tested; the report shows it as partial.

`waivers.tsv` is the one list of what is not tested, a line each: `id`
(`F-020` or a row's id), `on` (`gmail`, `outlook` or `both` for a
function, `-` for a row), `kind` and `reason`. The kinds: `bug` (the app
is wrong; a `@known-bug` test waits for the fix), `needs` (a service, a
clock or a feature flag no stack gives a test), `native-only`,
`no-user-path`, and `backlog` (could be tested and is not yet; shown as
open). A new line is a decision a reviewer reads: say why, not that.

Two rows that describe one element (the same button listed under two
surfaces) are not waived: delete one and name it in the other's `note`. A
menu entry and a button that call the same function are two elements and
stay two rows.

`full-stack-only.tsv` lists what only the full-stack tier's tests cover.
Each job is held to its own part: the tier's job to that list, the browser
job to everything else that is not waived. Do not edit it by hand: run both
stacks, then `--record`. A test moved from one stack to the other changes
it, and the job says which line to remove.

## Marking a test

```ts
import { confirmed, did, saw } from './ledger/record';

await page.getByRole('button', { name: 'Mark done' }).click();
did('AL-174', 'F-071');               // the action, where it is performed
await expect(row).toBeHidden();
saw('STL-074', 'F-071');              // the state, where it is asserted
expect(await mailbox.providerLabels(id)).not.toContain('INBOX');
confirmed('F-071');                   // the result at the provider
```

- Call it on the line that does or asserts the thing, so that a test which
  fails before it does not count. A helper in `harness/` that performs an
  action calls `did` itself.
- `did` and `saw` take the function when the row belongs to several (a
  toggle such as "Mark done / Mark not done"), and may leave it out when the
  row has one.
- `confirmed` goes after an assertion on what the provider's mailbox holds
  (`mailbox.providerMessages()` and the like), or on what the service
  answers when `functions.tsv` says `service`.
- An id that is not in the manifest throws.
- Mark what the test does as a user. A state set up through the API or the
  emulator is not an action; a request the test makes itself
  (`mailbox.api`) is not the app's and is left out of the network evidence.
- Requests need no marking.

## Proving a test

A test that passes proves little until it has failed for the right reason.
For each function a test covers, put the bug back: change the product code so
the function no longer works, guarded by a name so that one bundle can carry
many breaks and each run switches on one:

```ts
if ((globalThis as { emailE2eBreak?: string }).emailE2eBreak === 'F-073') return;
```

Build that bundle outside the tree, then run the function's tests against it
with `EMAIL_E2E_DIST=<bundle> EMAIL_E2E_BREAK=F-073`: they must fail at the
function's own assertion, and pass on the clean bundle. Record the function
and the break, in words, in `proofs.tsv`. The breaks are never committed.

Before any proof, run the suite against the bundle of breaks with no break
switched on: it must pass. A guard written wrongly (a boolean where the code
passes an accessor, say) breaks the app for every run, and each test then
fails before its own assertion, which looks like a proof and is none. For the
same reason read where the broken run failed: a failure in the steps that
lead to the row's assertion proves nothing about the row. A line in
`proofs.tsv` stands only for a break that was run this way.

A way into a function (an action row: a menu entry, a shortcut, a button) is
proved the same way, with the row's id as the name of the guard, in the
wiring of that way in rather than in what it calls: the point is that it can
break alone. One break for each distinct handler or wiring is enough; its
line in `proofs.tsv` is under the row it was run for and names the other
rows that go through the same wiring. A state row is proved by a break in
the code that shows the state (its text changed, or its rendering switched
off), under the row's id.

Every row that is not waived needs its own line in `proofs.tsv`, and the
check fails without it. A row that goes through another row's wiring or
render site is run against that row's break, and its line says which break
it shares and why the row goes through it. A row that only the full-stack
tier covers is proved there: the same bundle of breaks, run against a local
stack instance, first with no break switched on. A test that passes with its row
broken is weak: give it an assertion on what the row alone does or shows
before recording a proof.

A function whose work is the service's (the sync functions) is proved by a
break in the service code instead: the same kind of guard on the process
environment variable `EMAIL_E2E_BREAK`, in a build of the services kept
outside the tree and named by `EMAIL_E2E_BIN_DIR`. The stack starts the
services with a cleared environment, so the uncommitted patch also forwards
that one variable in `crates/email_e2e/src/process.rs`.

## Changing the manifest

- Ids are stable: never renumber, never reuse. A new function takes the next
  `F-` number at the end of `functions.tsv`; a new row takes the next number
  of its prefix (`AL`, `AC`, `AX` actions; `STL`, `STC`, `STX` states; `SL`,
  `SC`, `SX` surfaces).
- `providers` and `viewports` say where a row exists; left out, it exists on
  both providers and on the layouts of its surface.
- An action names what the code registers for it in `registered` (a hotkey
  token, or `<file>#<description>`), a toast state names its toasts in
  `toasts` (`<file>#<text>`): `bun tests/email-e2e/ledger/derive.ts hotkeys`
  and `... toasts` print the names.
- New UI gets its rows in the same change, with a test or a `waiver`; a new
  thing a user can do gets a function.

## What is checked against the source

`derive.ts` reads these off the code, and the report lists every difference
under "Manifest against the source":

- the operations of email's own are the same in the source and in
  `manifest/network.ts`, where they have `scope: 'email'`: a GraphQL
  operation in an `email-*.graphql` document or in
  `EMAIL_OPERATIONS_ELSEWHERE` in `derive.ts`, and every call of the email
  service's client that is not to the calendar. The other operations are
  not checked, whatever their name: adding, renaming or removing one has no
  meaning for email and must not fail this job. Those an email page makes
  all the same (Soup, saved views, notifications, the calendar's
  occurrences) are listed as `shared` and kept by hand; the rest are not
  listed;
- every hotkey the email code registers and every email hotkey token is on an
  action row;
- every toast the email code raises is on a state row;
- every source file a row names exists, when it is one of email's own: under
  the email directories, or in `EMAIL_FILES_ELSEWHERE` in `derive.ts` (a file
  elsewhere that holds only email; add a new one there). The difference names
  the row and the manifest file to change. A file shared with the rest of the
  app that is gone is listed as reported only: it is not counted and fails
  nothing;
- ids are unique, rows are on a surface of their group;
- every row belongs to a function of `functions.tsv`, and every function
  with a UI has a row, and a state row to see its result by.

Requests made in a run that the manifest does not list are reported too:
those of the rest of the app that an email page also makes, and any of
email's that lacks its line.
