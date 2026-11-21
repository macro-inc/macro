// What an inbox's row in Settings › Email shows while it syncs: Force sync
// held while the service starts a sync and while the inbox syncs, the
// backfill's progress with the time left, the notice when it is done or
// failed, and the calendar being turned off.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import {
  holdRequests,
  providerFault,
  steadyGateway,
} from './harness/states-settings';
import { openSettled } from './harness/ways-settings-more';
import { saw } from './ledger/record';

const RESYNC = /\/email\/email\/links\/[^/]+\/resync(\?|$)/;

test.beforeEach(({ page }) => loadAppSteadily(page));

// Only a Gmail inbox reports its backfill: an Outlook inbox's import sends
// no progress, completion or failure over the gateway.
test.describe('forcing a sync of a Gmail inbox', () => {
  // When this fails, Force sync can be pressed again while a sync is
  // starting or running, the row shows no progress (or no time left) while
  // the inbox imports, or nothing says the import finished or failed.
  test('Force sync is held while the import runs, which shows its progress and time left, then says it synced or failed', async ({
    page,
    mailbox,
  }) => {
    const own = mailbox.inbox.email;
    const stopRelay = await steadyGateway(page, mailbox);
    await openSettled(page, mailbox);
    // Mail the first import did not see, so the next one has 55 threads
    // to fetch: progress is reported at the first and the 50th.
    await mailbox.stack.seed(
      'GMAIL',
      own,
      Array.from({ length: 55 }, (_, index) => ({
        from: 'Grace <grace@example.com>',
        subject: `Old note ${index + 1}`,
        text: `Note ${index + 1}.`,
      }))
    );
    // The first thread comes at once and the next 49 a little later, so the
    // two reports are apart in time; the rest are slow, which keeps the
    // import at its 50th thread while the row is read.
    const pacing = [
      await providerFault(mailbox, { route: 'threads.get', times: 1 }),
      await providerFault(mailbox, {
        route: 'threads.get',
        delay_ms: 400,
        times: 49,
      }),
      await providerFault(mailbox, { route: 'threads.get', delay_ms: 8_000 }),
    ];

    const starting = await holdRequests(page, RESYNC, 'POST');
    const force = page.getByRole('button', { name: `Force sync ${own}` });
    await force.click();
    await expect(force).toBeDisabled();
    saw('STX-201');
    starting.release();
    await expect(notice(page, 'Re-sync started')).toBeVisible();

    await expect(page.getByText('Backfilling…')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/^50 of \d+ threads$/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/^~\d+[smh]( \d+m)? left$/)).toBeVisible();
    saw('STX-008');
    await expect(force).toBeDisabled();
    saw('STX-201');
    for (const takeBack of pacing) await takeBack();

    await expect(notice(page, 'Inbox synced')).toBeVisible({
      timeout: 60_000,
    });
    saw('STX-202');
    await expect(page.getByText('Backfilling…')).toBeHidden();
    await expect(force).toBeEnabled();

    // The provider now refuses to list the mailbox: the next import fails.
    const refusing = await providerFault(mailbox, {
      route: 'threads.list',
      error: 'forbidden',
    });
    await force.click();
    await expect(notice(page, 'Inbox sync failed')).toBeVisible({
      timeout: 60_000,
    });
    saw('STX-203');
    await refusing();
    await expect(force).toBeEnabled();
    await stopRelay();
  });
});

// An Outlook inbox is connected with its calendar, so it has the calendar
// to turn off without granting it first.
test.describe('an Outlook inbox in Settings', () => {
  test.use({ provider: 'OUTLOOK' });

  // When this fails, Force sync can be pressed again before the service
  // answered or while the inbox still syncs, or turning the calendar off
  // shows nothing while its events are being removed (and can be pressed
  // twice).
  test('Force sync and Turn off wait for the service and say so', async ({
    page,
    mailbox,
  }) => {
    const own = mailbox.inbox.email;
    await openSettled(page, mailbox);

    const starting = await holdRequests(page, RESYNC, 'POST');
    const force = page.getByRole('button', { name: `Force sync ${own}` });
    await force.click();
    await expect(force).toBeDisabled();
    saw('STX-201');
    starting.release();
    await expect(notice(page, 'Re-sync started')).toBeVisible();
    // The list read after the sync started says the inbox syncs: the button
    // stays held. An Outlook import sends nothing when it ends, so the row
    // learns it on the next read of the list (here, a reload).
    await expect(page.getByText('Syncing…')).toBeVisible();
    await expect(force).toBeDisabled();
    saw('STX-201');
    await expect
      .poll(
        async () => {
          const response = await mailbox.api('/email/email/links');
          const { links } = (await response.json()) as {
            links: { email_address: string; sync_status: string }[];
          };
          return links.find((link) => link.email_address === own)?.sync_status;
        },
        { timeout: 60_000 }
      )
      .toBe('UP_TO_DATE');
    await page.reload();
    await expect(force).toBeEnabled();

    const turningOff = await holdRequests(
      page,
      /\/email\/email\/links\/[^/]+\/calendar(\?|$)/,
      'DELETE'
    );
    await page
      .getByRole('button', { name: `Turn off calendar for ${own}` })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Turn off calendar' });
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Turning off…' })
    ).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText(
      'Turning off calendar and removing synced events…'
    );
    saw('STX-205');
    turningOff.release();
    await expect(dialog).toBeHidden();
  });
});
