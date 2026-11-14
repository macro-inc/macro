# Email browser suite

The built web app in headless Chromium against the `crates/email_e2e` stack:
the real `email_service`, `pubsub_workers` and `document_storage_service`
(GraphQL), with the Gmail and Outlook emulators as the providers. Each test
gets its own stack, user and linked inbox, so tests run in parallel and share
nothing.

Use it for what only the whole path can decide: what the composer really
sends, what the list and thread view do with what the services answer, what
reaches the provider. Logic of one component belongs in that feature's
`browser-test/` fixture suite, which needs no backend and is much cheaper.

## Running

```sh
just email-e2e-browser                 # builds the services, the stack server and the bundle, then runs
just email-e2e-browser reply           # arguments go to Playwright
just apps/web/test-email-e2e-browser   # only the run, when everything is built
```

It needs what `just email-e2e` needs (`crates/email_e2e/AGENTS.md`: Postgres,
Redis, an ElasticMQ and a Kafka broker in `EMAIL_E2E_*`), the repository's
`bun install`, and Chromium (`bunx playwright install chromium`, or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). `EMAIL_E2E_BROWSER_WORKERS` sets how
many tests run at once (4); each runs three services and a browser.

## How it works

- `global-setup.ts` starts `email_e2e_stacks` (`crates/email_e2e/src/stack_server.rs`),
  which starts and stops stacks over HTTP; `harness/stack.ts` is its client.
- `harness/front.ts` gives each test one origin that serves the bundle
  (`apps/web/dist`, or `EMAIL_E2E_DIST`) and proxies `/email` and `/dss` to
  that test's services, signing each request as the test's user with the
  services' internal headers. There is no authentication service: the few
  `/auth` calls the app needs at startup are answered there, and `front.stub`
  answers more.
- The bundle is built by `just apps/web/build-email-e2e`: every service on the
  page's own origin.
- The connection gateway is not run. The fixture answers the browser's gateway
  socket and passes on what the email services ask the gateway to send the user.
- Not in the stack: the notification, search, contacts and calendar services.
  New mail does not appear in an open list by itself; sync, then open.

## Writing a test

```ts
import { expect, test } from './harness/fixtures';

test('a reply goes out in the thread', async ({ page, mailbox }) => {
  await mailbox.deliver({ from: 'Grace <grace@example.com>', subject: 'Lunch?', text: 'Noon?' });
  const thread = await mailbox.synced('Lunch?');       // Macro has it
  await mailbox.open(`/app/mail/${thread.id}`);
  await page.getByText('Reply...').click();
  await page.keyboard.type('Yes.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(async () => (await mailbox.providerMessages()).filter((m) => m.labels.includes('SENT')).length)
    .toBe(1);
});
```

- `test.use({ provider: 'OUTLOOK' })` links an Outlook inbox; `stackEnv` sets
  service environment; `mailbox.stack.link` links a second inbox.
- Act as the provider with `mailbox.deliver`, `mailbox.stack.seed` and the
  emulators' control APIs (`stack.info.gmailUrl`, `outlookUrl`); observe with
  `mailbox.providerMessages()`, `gmailRawMessage` (`harness/provider.ts`), the
  email API (`mailbox.api`), `stack.serviceRequests()`, `stack.storedObjects()`
  and, last, `stack.sql`.
- Failures of what the app depends on: `stack.failNextServiceRequest`,
  `stack.refuseQueueSends`, emulator faults, and Playwright's `page.route`.
- Never sleep: wait with `expect.poll` and locators.
- Say in a comment above the test what goes wrong when it fails.
- A test for a bug that is not fixed yet asserts the right behaviour and is
  tagged `{ tag: '@known-bug' }`. The suite leaves it out;
  `EMAIL_E2E_KNOWN_BUGS=1` runs only those (a non-gating CI step).
- A new test must fail with its bug put back: build a bundle with the fix
  reverted into another directory and run with `EMAIL_E2E_DIST` pointing at it.
- A failing test prints its service log directory and keeps a Playwright trace
  in `test-results/`.

CI: the `Email end-to-end (browser)` workflow (`xtask_workflows`'
`email_e2e_browser.rs`) runs on pushes to `main` that change the web app or
backend code and, within `PR CI`, on pull requests that touch email or
calendar code on either side.

## What is here

One spec file per area; helpers a file shares with others are in `harness/`.

| Files | Area | Helpers |
| --- | --- | --- |
| `reply`, `send-*` | what a reply, forward or new message sends, undo, send outcome | `harness/send.ts` |
| `draft-*`, `attachment` | draft saving, discarding and recovery, attachments, the editor | `harness/drafts.ts` |
| `list`, `state`, `inbox`, `folders` | the list, Done and read state, inbox selection, Sent, folders | `harness/list.ts` |
| `thread*`, `render` | the thread view, opening from search, pictures in a message | `harness/thread.ts` |
| `link*`, `notify` | connecting inboxes and calendars, the Mail badge | `harness/linking.ts` |
| `calendar-invitation` | the invitation card in a thread | |

- `harness/linking.ts` stands in for the authentication service's link
  endpoints and the provider callback; the consent pages are the emulators'.
- `list.spec.ts`'s new-mail test runs only with `EMAIL_E2E_LIVE_UPDATES=1`
  and alone: every stack's services read live updates in one Kafka consumer
  group, so another running stack can take the event.

## Fixture tests

Bugs that one component decides are covered in the features' `browser-test/`
suites instead (the email composer, the calendar, event details, signatures,
unavailable mentions) and in `packages/email-renderer`. `just
apps/web/test-email-fixtures-browser` runs the ones that cover an email or
calendar bug class; the recipe lists them. The CI job runs it beside this
suite. `src/features/calendar/browser-test` mounts the calendar over scripted
`/calendar` routes until `calendar_service` is part of the stack.
