# Coverage ledger of the email UI

What "email is covered" means for the web app, measured: a list of the
functions of email, a manifest of every way to do each of them in the UI and
of what the app then shows, and the evidence the browser suite records while
it runs.

```sh
just apps/web/test-email-e2e-browser        # the run records the evidence
just apps/web/email-e2e-ledger              # the report, from the last run
just apps/web/email-e2e-ledger --enforce    # ... and fail on what is not covered
```

The report is written to `../ledger-results/report/`: `index.html`,
`summary.md` (the CI job summary) and `ledger.json`. In CI it is the
`email-e2e-browser-coverage` artifact of the `Email end-to-end (browser)` job.

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

A covered function is **proved** when `proofs.tsv` names the break that was
put into the product for it and made its tests fail (see Proving a test). The
headline counts covered and proved functions; a covered function without a
proof passes, and nothing shows it would catch a regression.

It is **in part** when tests show some of that, **deferred** or **waived**
when every way to do it is, and **open** otherwise.

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
- **open**: never seen, and the suite could drive it;
- **deferred**: never seen, and it has `needs`: a service or a clock the
  per-test stack does not have. These wait for the full-stack tier;
- **waived**: never seen, and it has a `waiver` with a reason.

The report only reports. `--enforce` (or `EMAIL_E2E_LEDGER_ENFORCE=1`) makes
it fail when a function or a row is open or partial, an email network
operation is not covered, or the manifest differs from the source.

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

- every operation in the GraphQL documents and every call of the email
  service's client is in `manifest/network.ts`, and nothing else is;
- every hotkey the email code registers and every email hotkey token is on an
  action row;
- every toast the email code raises is on a state row;
- every source file a row names exists, ids are unique, rows are on a surface
  of their group;
- every row belongs to a function of `functions.tsv`, and every function
  with a UI has a row, and a state row to see its result by.

Requests the app made that the manifest does not list are reported too.
