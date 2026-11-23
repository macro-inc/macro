// What a row's menu does to the sender of a thread: blocked and unblocked
// again from the notice, moved to Noise and back to Signal. Each for a Gmail
// and an Outlook inbox; the email service holds the block list and the
// sender filters.

import { createHash } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** The senders the email service answers as blocked in the inbox. */
async function blocked(mailbox: Mailbox): Promise<string[]> {
  const response = await mailbox.api('/email/email/contacts/blocked');
  return ((await response.json()) as { blocked_emails: string[] })
    .blocked_emails;
}

/** The inbox's sender filters: the address and whether it is Signal. */
async function senderFilters(
  mailbox: Mailbox
): Promise<{ address: string | null; signal: boolean }[]> {
  const response = await mailbox.api('/email/email/filters');
  const body = (await response.json()) as {
    filters: { email_address: string | null; is_important: boolean }[];
  };
  return body.filters.map((filter) => ({
    address: filter.email_address,
    signal: filter.is_important,
  }));
}

// Keep retry traces and a bounded state receipt in the always-uploaded report.
test.use({ trace: 'on-first-retry' });
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus || testInfo.retry > 0) {
    const state = JSON.stringify({
      menuItems: await page.getByRole('menuitem').allTextContents(),
      rowIds: await rowIds(page),
    });
    testInfo.annotations.push({
      type: 'sender-menu-state',
      description: state,
    });
    await testInfo.attach('sender-menu-state', {
      body: state,
      contentType: 'application/json',
    });
  }
});

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`the sender of a thread in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    test('unchanged live refreshes keep the sender menu and row stable', async ({
      page,
      mailbox,
    }, testInfo) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      await mailbox.deliver({
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'From Friday.',
      });
      const agenda = await mailbox.synced('Agenda');
      const photos = await mailbox.synced('Team photos');
      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([agenda.id, photos.id].sort());
      await row(page, photos.id).click({ button: 'right' });
      await page
        .getByRole('menuitem', { name: 'Sender → Noise', exact: true })
        .click();
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'hal@example.com', signal: false }]);
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      const noiseRequest = page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith('/dss/items/soup/graphql') &&
          /\bquery\s+Soup\s*[( {]/.test(request.postDataJSON()?.query ?? '') &&
          JSON.stringify(request.postDataJSON()?.variables).includes(
            '"importance":false'
          )
      );
      await page
        .getByRole('radiogroup', { name: 'Inbox view' })
        .getByText('Noise', { exact: true })
        .click();
      const noise = await noiseRequest;
      const noiseResponse = await noise.response();
      expect(noiseResponse?.status()).toBe(200);
      await noiseResponse?.finished();
      await expect.poll(() => rowIds(page)).toEqual([photos.id]);
      const signal = page.getByRole('menuitem', {
        name: 'Sender → Signal',
        exact: true,
      });
      // Noise can replace its first row while settling after the response.
      // Establish the open menu before taking the baseline for any wake.
      await expect(async () => {
        if (!(await signal.isVisible())) {
          await row(page, photos.id).click({ button: 'right' });
        }
        await expect(signal).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 20_000 });
      // The tab may replace its first rows while settling. Start the unchanged-
      // refresh baseline on the row whose menu is now open.
      const original = await row(page, photos.id).elementHandle();
      if (!original)
        throw new Error('Expected the Noise row with its menu open');
      const wakeFacts: object[] = [];
      const wakes = [
        () =>
          mailbox.emitRefresh({
            event: 'upsert_message',
            link_id: mailbox.inbox.linkId,
          }),
        () =>
          mailbox.emitRefresh({
            event: 'backfill_progress',
            link_id: mailbox.inbox.linkId,
            status: 'complete',
            completed_threads: 2,
            total_threads: 2,
          }),
        () =>
          page.evaluate(() =>
            document.dispatchEvent(new Event('visibilitychange'))
          ),
      ];
      try {
        for (const [wakeIndex, wake] of wakes.entries()) {
          wakeFacts.push({
            wakeIndex,
            phase: 'before-wake',
            connected: await original.evaluate(
              (element) => element.isConnected
            ),
            sameNode: await row(page, photos.id).evaluate(
              (element, reference) => element === reference,
              original
            ),
          });
          if (wakeIndex === 2) {
            // Showing a clean tab keeps its existing row and menu without IO.
            // Advance beyond the list's coalescing interval so a delayed read
            // would also be observed, without a wall-clock sleep.
            const now = new Date();
            await page.clock.install({ time: now });
            await page.clock.pauseAt(new Date(now.getTime() + 1_000));
            let soupRequests = 0;
            const recordSoup = (request: Request) => {
              if (
                request.method() === 'POST' &&
                new URL(request.url()).pathname.endsWith(
                  '/dss/items/soup/graphql'
                ) &&
                /\bquery\s+Soup\s*[( {]/.test(
                  request.postDataJSON()?.query ?? ''
                )
              )
                soupRequests += 1;
            };
            page.on('request', recordSoup);
            try {
              await wake();
              await page.clock.runFor(5_001);
              wakeFacts.push({
                wakeIndex,
                phase: 'clean-visibility',
                soupRequests,
                connected: await original.evaluate(
                  (element) => element.isConnected
                ),
                sameNode: await row(page, photos.id).evaluate(
                  (element, reference) => element === reference,
                  original
                ),
              });
              expect(soupRequests).toBe(0);
            } finally {
              page.off('request', recordSoup);
              await page.clock.resume();
            }
          } else {
            // Match a request started after this listener, never an in-flight
            // response from the tab change. The first hint may wait up to 5 s.
            const refreshed = page
              .waitForRequest(
                (request) =>
                  request.method() === 'POST' &&
                  new URL(request.url()).pathname.endsWith(
                    '/dss/items/soup/graphql'
                  ) &&
                  request.postData() === noise.postData(),
                { timeout: 15_000 }
              )
              .catch((cause: unknown) => {
                throw new Error(
                  `Wake ${wakeIndex} did not request the Noise list`,
                  { cause }
                );
              });
            await wake();
            const request = await refreshed;
            const response = await request.response();
            expect(response?.status()).toBe(200);
            if (!response) throw new Error(`Wake ${wakeIndex} had no response`);
            await response.finished();
            wakeFacts.push({
              wakeIndex,
              phase: 'after-wake',
              connected: await original.evaluate(
                (element) => element.isConnected
              ),
              sameNode: await row(page, photos.id).evaluate(
                (element, reference) => element === reference,
                original
              ),
              requestHash: createHash('sha256')
                .update(request.postData() ?? '')
                .digest('hex'),
              responseHash: createHash('sha256')
                .update(await response.body())
                .digest('hex'),
            });
          }
          expect(
            await original.evaluate((element) => element.isConnected)
          ).toBe(true);
          expect(
            await row(page, photos.id).evaluate(
              (element, reference) => element === reference,
              original
            )
          ).toBe(true);
          await expect(signal).toBeVisible();
        }
      } finally {
        await testInfo.attach('sender-menu-wakes', {
          body: JSON.stringify(wakeFacts),
          contentType: 'application/json',
        });
      }
      await signal.click();
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'hal@example.com', signal: true }]);
      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([agenda.id, photos.id].sort());
    });

    // When this fails, Block Sender shows its notice and the sender is not
    // blocked in the mailbox, or Undo leaves the sender blocked.
    test('Block Sender blocks the sender, Undo in its notice unblocks', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      await mailbox.deliver({
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'From Friday.',
      });
      await mailbox.synced('Agenda');
      const photos = await mailbox.synced('Team photos');

      await mailbox.open();
      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Block Sender' }).click();
      did('AL-088');
      const queued = notice(page, 'Sender block queued');
      await expect(queued).toContainText('hal@example.com');
      saw('STL-050', 'F-080');
      // The notice stays for as long as the pointer is on it: the service
      // can take longer over the block than the notice otherwise lasts.
      await queued.hover();
      await expect.poll(() => blocked(mailbox)).toEqual(['hal@example.com']);
      confirmed('F-080');

      await queued.getByRole('button', { name: 'Undo' }).click();
      did('AL-904');
      await expect(notice(page, 'Sender unblock queued')).toBeVisible();
      saw('STL-050', 'F-196');
      await expect.poll(() => blocked(mailbox)).toEqual([]);
      confirmed('F-196');
    });

    // When this fails, Sender → Noise or Sender → Signal shows its notice
    // and saves no filter (or the wrong one), so the sender's mail stays
    // where it was.
    test('Sender → Noise moves the sender to Noise, Sender → Signal back', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      await mailbox.deliver({
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'From Friday.',
      });
      const agenda = await mailbox.synced('Agenda');
      const photos = await mailbox.synced('Team photos');
      const views = page.getByRole('radiogroup', { name: 'Inbox view' });

      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([agenda.id, photos.id].sort());
      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Noise' }).click();
      did('AL-087');
      await expect(notice(page, 'Sender marked as Noise')).toContainText(
        'hal@example.com'
      );
      saw('STL-051', 'F-081');
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'hal@example.com', signal: false }]);
      confirmed('F-081');
      // Signal no longer lists the sender's thread; Noise does.
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      await views.getByText('Noise', { exact: true }).click();
      await expect.poll(() => rowIds(page)).toEqual([photos.id]);

      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Signal' }).click();
      did('AL-086');
      await expect(notice(page, 'Sender marked as Signal')).toContainText(
        'hal@example.com'
      );
      saw('STL-051', 'F-081');
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'hal@example.com', signal: true }]);
      confirmed('F-081');
      // Loaded again, Signal lists both threads.
      await mailbox.open();
      await expect
        .poll(async () => (await rowIds(page)).sort())
        .toEqual([agenda.id, photos.id].sort());
    });

    // When this fails, the filter saves but the open Noise list keeps the
    // sender's thread, or Signal does not show it when opened without a reload.
    test('Sender → Signal takes the thread out of the Noise list', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Hal <hal@example.com>',
        subject: 'Team photos',
        text: 'From Friday.',
      });
      const photos = await mailbox.synced('Team photos');
      const views = page.getByRole('radiogroup', { name: 'Inbox view' });

      await mailbox.open();
      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Noise' }).click();
      await expect.poll(() => rowIds(page)).toEqual([]);
      await views.getByText('Noise', { exact: true }).click();
      await expect.poll(() => rowIds(page)).toEqual([photos.id]);

      await row(page, photos.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Sender → Signal' }).click();
      did('AL-086');
      await expect(notice(page, 'Sender marked as Signal')).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([]);
      await views.getByText('Signal', { exact: true }).click();
      await expect.poll(() => rowIds(page)).toEqual([photos.id]);
      await expect
        .poll(() => senderFilters(mailbox))
        .toEqual([{ address: 'hal@example.com', signal: true }]);
      confirmed('F-081');
    });
  });
}
