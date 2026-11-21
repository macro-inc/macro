// A draft open in a second browser of the same user while the first one
// works on it: an attachment still uploading, a send that is queued, and a
// draft deleted meanwhile.

import type { Page, Request } from '@playwright/test';
import {
  composeNew,
  discardButton,
  draftThreads,
  graphqlOperation,
  loadAppSteadily,
  relayUploads,
  routeDraftId,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice, threadMessages } from './harness/send';
import {
  chooseFileToAttach,
  draftElsewhere,
  holdRequests,
  returnToTab,
  toolbarButtons,
  tooltip,
} from './harness/states-compose';
import { saw } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

/** How many attachments the service holds on the user's one draft. */
async function draftAttachments(mailbox: Mailbox): Promise<number> {
  const [thread] = await draftThreads(mailbox);
  if (!thread) return 0;
  return (await threadMessages(mailbox, thread.id))
    .filter((message) => message.is_draft)
    .flatMap((message) => message.attachments_draft ?? []).length;
}

/** How many reads of the queued sends `page` has sent and not had answered. */
function openSendReads(page: Page): () => number {
  const open = new Set<Request>();
  const done = (request: Request) => open.delete(request);
  page.on('request', (request) => {
    if (graphqlOperation(request) === 'PendingEmailSends') open.add(request);
  });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return () => open.size;
}

for (const provider of PROVIDERS) {
  test.describe(`a draft in ${anInbox(provider)} opened in a second browser`, () => {
    test.use({ provider });

    // When this fails, a draft whose attachment never finished uploading
    // shows the file as if it were ready, so it would be sent without it.
    // Whether an upload is finished is held per provider.
    test('an attachment still uploading shows as unfinished there', async ({
      page,
      mailbox,
      browser,
    }) => {
      let release = () => {};
      await relayUploads(
        page,
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Upload pending',
        body: 'The file follows.',
      });
      await routeDraftId(page);
      await chooseFileToAttach(page, toolbarButtons(page).nth(1), {
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('notes'),
      });
      await expect
        .poll(() => draftAttachments(mailbox), { timeout: 30_000 })
        .toBe(1);

      const other = await draftElsewhere(browser, mailbox, 'Upload pending');
      await expect(
        other.page.getByText('notes.txt — upload unfinished', { exact: true })
      ).toBeVisible();
      await expect(
        other.page.getByRole('button', {
          name: 'Remove notes.txt — upload unfinished',
        })
      ).toBeVisible();
      saw('STC-011');
      await other.close();
      release();
    });
  });
}

test.describe('a send queued in one browser', () => {
  test.use({ stackEnv: { SENT_UNDO_DELAY_SECS: '120' } });

  // When this fails, a draft open in another browser can be sent a second
  // time once its send is queued here, or its Send is blocked without saying
  // why.
  // The send queue is Macro's own, the same whatever the provider: Gmail
  // only.
  test('a link to the draft opened in another browser blocks Send and says the send is queued', async ({
    page,
    mailbox,
    browser,
  }) => {
    await composeNew(page, mailbox, {
      to: 'grace@example.com',
      subject: 'Queued elsewhere',
      body: 'On its way.',
    });
    await routeDraftId(page);
    const link = page.url();
    const other = await draftElsewhere(browser, mailbox, 'Queued elsewhere');
    const reads = openSendReads(other.page);
    // Opened at its link while the draft is still there: once the send is
    // queued, a fresh open of the link may no longer find the draft.
    await other.page.goto(link);
    await expect(other.page.getByPlaceholder(/subject/i)).toHaveValue(
      'Queued elsewhere'
    );
    const otherSend = other.page.getByRole('button', {
      name: 'Send email',
      exact: true,
    });
    await expect(otherSend).toBeEnabled();

    const accepted = page.waitForResponse(
      (response) =>
        graphqlOperation(response.request()) === 'SendEmailMessage' &&
        response.ok()
    );
    await page.getByRole('button', { name: 'Send email', exact: true }).click();
    await page.mouse.move(0, 0);
    await expect(notice(page, 'Sending…')).toBeVisible();
    // Coming back to the tab is when it reads the queued sends again; the
    // service holds this one once it has answered the send. A read already
    // under way then may predate the send, and the tab does not read again
    // for it, so the test comes back once none is.
    await accepted;
    await expect.poll(reads).toBe(0);
    // It reads the draft's thread again too, and once that shows the send it
    // gives way to the thread: held, so the composer stays while it says why
    // Send waits.
    const threadReads = await holdRequests(
      other.page,
      (request) =>
        request.method() === 'GET' &&
        /\/email\/threads\/[^/]+$/.test(new URL(request.url()).pathname)
    );
    await returnToTab(other.page);
    await expect(otherSend).toBeDisabled();
    await otherSend.hover({ force: true });
    await expect(
      tooltip(other.page, 'Queued to send. Cancel the send before editing.')
    ).toBeVisible();
    saw('STC-045');
    await other.close();
    await threadReads.release();
  });
});

// When this fails, a draft deleted in one browser stays editable and
// sendable in another that has its link open: it never learns the draft is
// gone.
// The draft lifecycle is Macro's own: Gmail only.
test('a draft deleted in one browser says so in the other', async ({
  page,
  mailbox,
  browser,
}) => {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject: 'Deleted elsewhere',
    body: 'Soon gone.',
  });
  await routeDraftId(page);
  const link = page.url();
  const other = await draftElsewhere(browser, mailbox, 'Deleted elsewhere');
  await other.page.goto(link);
  await expect(other.page.getByPlaceholder(/subject/i)).toHaveValue(
    'Deleted elsewhere'
  );

  await discardButton(page).click();
  await expect(page.getByPlaceholder(/subject/i)).toHaveValue('');
  await expect.poll(() => draftThreads(mailbox)).toEqual([]);
  // The open composer reads its draft again every 15 seconds.
  await expect(
    notice(other.page, 'This draft is no longer available.')
  ).toBeVisible({ timeout: 40_000 });
  await expect(other.page.getByPlaceholder(/subject/i)).toBeDisabled();
  const otherSend = other.page.getByRole('button', {
    name: 'Send email',
    exact: true,
  });
  await expect(otherSend).toBeDisabled();
  await otherSend.hover({ force: true });
  await expect(
    tooltip(other.page, 'This draft is no longer available.')
  ).toBeVisible();
  saw('STC-047');
  await other.close();
});
