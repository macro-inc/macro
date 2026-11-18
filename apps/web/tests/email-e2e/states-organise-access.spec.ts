// Asking for access to a thread from its Share dialog. A thread's request is
// for View, so only someone without access has one to make, and for them
// the Share dialog is reached from a row of the list: a thread that was
// shared with the user and taken back while their list still shows it. The
// row's Share opens the dialog with the owner the list knows; the dialog in
// the open thread is never reached, since the thread no longer opens.
//
// The app scans the threads shared with the user once it has loaded, and that
// scan drops a thread whose access is gone; the access is taken back after it,
// as when the owner takes it back while the user's list is open.
//
// Sharing with a person is sent through the channels service, which the
// stack does not run, so the grant, and taking it back, are written to the
// database here, as in sharing.spec.ts.

import type { Locator, Page, Response } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import type { SignedInUser } from './harness/front';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  answerSharingAsUser,
  apiKey,
  grantView,
  readStatus,
  sharingApi,
  threadOf,
} from './harness/sharing';
import type { Provider } from './harness/stack';
import { openTouchTab, PHONE } from './harness/ways-list1';
import { longPress, rowMenu } from './harness/ways-organise';
import { shareDialog } from './harness/ways-organise-more';
import { confirmed, did, saw } from './ledger/record';

/** A thread another person of the stack owns and shared with the user. */
type SharedThread = { owner: SignedInUser; id: string };

/**
 * A thread of another person of the stack, shared with the signed-in user,
 * and the page's sharing calls answered for that user.
 */
async function sharedWithUser(
  page: Page,
  mailbox: Mailbox,
  provider: Provider
): Promise<SharedThread> {
  const owner = await mailbox.stack.user('bob@example.com');
  await mailbox.stack.link(owner, provider);
  await mailbox.stack.deliver('bob@example.com', {
    from: 'Hugo <hugo@example.com>',
    subject: 'Budget',
    text: 'About Budget.',
  });
  const id = await threadOf(mailbox, 'bob@example.com');
  await grantView(mailbox, id, mailbox.user);
  await answerSharingAsUser(page, mailbox);
  return { owner, id };
}

/** The app's scan of the threads shared with the user, once it lists this one. */
function sharedScan(page: Page, threadId: string): Promise<Response> {
  return page.waitForResponse(async (response) => {
    const request = response.request();
    if (
      request.method() !== 'POST' ||
      !request.url().endsWith('/items/soup/graphql')
    )
      return false;
    const body = request.postDataJSON() as { operationName?: string } | null;
    if (body?.operationName !== 'SoupSharedMailBackfill') return false;
    return (await response.text()).includes(threadId);
  });
}

/** Takes back the view access a share with the signed-in user gave them. */
async function takeBackAccess(
  mailbox: Mailbox,
  threadId: string
): Promise<void> {
  await mailbox.stack.sql(
    `DELETE FROM entity_access
     WHERE entity_id = '${threadId}'::uuid AND entity_type = 'email_thread'
       AND source_id = '${mailbox.user.macroUserId}' AND source_type = 'user'
     RETURNING entity_id`
  );
  await expect
    .poll(() => readStatus(mailbox, mailbox.user, threadId))
    .toBe(401);
}

/** Asks for access in the Share dialog's roster and waits for it to be sent. */
async function requestAccess(roster: Locator): Promise<void> {
  const ask = roster.getByRole('button', { name: 'Request access' });
  await expect(ask).toBeEnabled();
  await ask.click();
  did('AL-903');
  await expect(
    roster.getByText('Access requested', { exact: true })
  ).toBeVisible();
  await expect(
    roster.getByRole('button', { name: 'Request sent' })
  ).toBeDisabled();
  await expect(
    roster.getByRole('button', { name: 'Cancel request' })
  ).toBeVisible();
}

/** Whether the owner is asked: the request the storage service holds. */
async function expectRequestAtOwner(
  mailbox: Mailbox,
  thread: SharedThread
): Promise<void> {
  const answer = await sharingApi(
    mailbox,
    await apiKey(mailbox, thread.owner),
    thread.id,
    'access-requests'
  );
  expect(answer.status).toBe(200);
  const state = (await answer.json()) as {
    pendingCount: number;
    requests: { requesterId: string; requestedLevel: string; status: string }[];
  };
  expect(state.pendingCount).toBe(1);
  expect(state.requests).toEqual([
    expect.objectContaining({
      requesterId: mailbox.user.macroUserId,
      requestedLevel: 'view',
      status: 'pending',
    }),
  ]);
}

for (const provider of PROVIDERS) {
  test.describe(`asking for access to a thread of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, someone who lost access to a thread still on their
    // list cannot ask its owner for it from the Share dialog, or the dialog
    // does not show that the request was sent.
    test('a thread shared and taken back asks its owner for access from the Share dialog', async ({
      page,
      mailbox,
    }) => {
      const budget = await sharedWithUser(page, mailbox, provider);
      const scanned = sharedScan(page, budget.id);

      await mailbox.open();
      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'Shared' })
        .click();
      await expect.poll(() => rowIds(page)).toEqual([budget.id]);
      await scanned;
      await takeBackAccess(mailbox, budget.id);

      await rowMenu(page, budget.id, /^Share/);
      await requestAccess(shareDialog(page, 'Budget'));
      saw('STL-942');

      await expectRequestAtOwner(mailbox, budget);
      confirmed('F-160');
    });
  });
}

// Gmail only: the phone's drawers are the screen's, and the request is the
// storage service's whatever the mailbox.
test.describe('asking for access to a thread on a phone', () => {
  test.use({ ...PHONE, provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the phone's Share drawer, opened from a long press on a
  // thread the user lost access to, offers no way to ask for it, or does not
  // show that the request was sent.
  test("a thread shared and taken back asks its owner for access from the phone's Share drawer", async ({
    page,
    mailbox,
  }) => {
    const budget = await sharedWithUser(page, mailbox, 'GMAIL');
    const scanned = sharedScan(page, budget.id);
    const actions = page.getByRole('dialog', { name: 'Entity actions' });
    const share = page.getByRole('dialog', { name: 'Share' });

    await mailbox.open();
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      PHONE.viewport.width
    );
    await openTouchTab(page, 'Shared');
    await expect.poll(() => rowIds(page)).toEqual([budget.id]);
    await scanned;
    await takeBackAccess(mailbox, budget.id);

    await longPress(page, budget.id, actions);
    await actions.getByRole('button', { name: /^Share/ }).tap();
    await expect(actions).toHaveCount(0);
    // The roster is the drawer's second tab, named for the owner alone.
    const tabs = share.getByRole('radiogroup');
    await tabs.getByText('Owner', { exact: true }).tap();
    await expect(tabs.getByRole('radio', { name: 'Owner' })).toBeChecked();
    await requestAccess(share);
    saw('STL-942');

    await expectRequestAtOwner(mailbox, budget);
  });
});
