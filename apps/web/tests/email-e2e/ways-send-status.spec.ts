// The schedule bar's Check status on a scheduled message whose delivery
// Macro could not confirm: it asks the service again and shows what the
// service holds now. And the Queued email sends panel's Check status on a
// send held until the inbox is reconnected: it sends it. For a Gmail and an
// Outlook inbox.

import {
  composeNew,
  graphqlOperation,
  loadAppSteadily,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { sentMessages } from './harness/send';
import {
  barButton,
  clock,
  openPicker,
  preset,
  scheduled,
  scheduledNotice,
} from './harness/ways-send';
import {
  draftStateReadsInFlight,
  setScheduledDelivery,
  silenceGateway,
} from './harness/ways-send-more';
import { did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`a scheduled message whose delivery is unconfirmed, in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Check status on an unconfirmed scheduled delivery
    // does not ask the service again: the bar keeps saying "Delivery
    // unconfirmed" after the service holds the message as scheduled again.
    test('Check status in the schedule bar shows the delivery state the service holds now', async ({
      page,
      mailbox,
    }) => {
      // An open composer asks the service again by itself when the socket
      // announces a message, and every 30 seconds: with the socket silent,
      // only Check status asks within the time this test waits.
      await silenceGateway(page);
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Held numbers',
        body: 'The numbers are in.',
      });
      await openPicker(page, clock(page));
      await preset(page, 'Tomorrow').click();
      await page
        .getByRole('button', { name: 'Schedule send', exact: true })
        .click();
      await expect(scheduledNotice(page)).toBeVisible();
      await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
      const [held] = await scheduled(mailbox);
      await setScheduledDelivery(mailbox, held.db_id, 'unconfirmed');

      await mailbox.open('/app/mail');
      // Counted from the new page on: a read the reload cut off never ends.
      const reads = draftStateReadsInFlight(page);
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Scheduled' })
        .click();
      await page.getByRole('main').getByText('Held numbers').click();
      const unconfirmed = page
        .getByRole('status')
        .filter({ hasText: 'Delivery unconfirmed' });
      await expect(unconfirmed).toBeVisible();
      // The composer reads the draft's state as it opens; a change made
      // before that read answers would reach the bar without Check status.
      await expect.poll(reads).toBe(0);

      // The service holds it as waiting for its time again, as when the
      // provider is found not to have it.
      await setScheduledDelivery(mailbox, held.db_id, 'pending');
      await (await barButton(page, 'Check delivery status')).click();
      did('AC-054');
      await expect(
        page.getByRole('status').filter({ hasText: /^Scheduled for / })
      ).toBeVisible();
      await expect(unconfirmed).toHaveCount(0);
    });
  });

  test.describe(`a send waiting for the inbox to be reconnected, in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Check status on a send held until the inbox is
    // reconnected does not resume it: the row stays in the panel and the
    // message never reaches the provider's Sent.
    test('Check status in the Queued email sends panel resumes a held send', async ({
      page,
      mailbox,
    }) => {
      // The service answers the send as needing the inbox reconnected,
      // until it is.
      let reconnected = false;
      await page.route(/\/graphql$/, async (route) => {
        if (
          reconnected ||
          graphqlOperation(route.request()) !== 'SendEmailMessage'
        )
          return route.fallback();
        await route.fulfill({
          json: {
            data: null,
            errors: [
              {
                message: 'reconnect this inbox',
                path: ['sendEmailMessage'],
                extensions: { code: 'NEEDS_REAUTH' },
              },
            ],
          },
        });
      });
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: 'Held numbers',
        body: 'The numbers are in.',
      });
      await page.getByRole('button', { name: 'Send email' }).click();

      // The panel is in Drafts.
      await page
        .getByRole('navigation', { name: 'Email tabs' })
        .getByRole('button', { name: 'Drafts' })
        .click();
      const sends = page.getByLabel('Queued email sends');
      await expect(
        sends.getByText(
          'Reconnect your email account, then check status to resume.'
        )
      ).toBeVisible();
      reconnected = true;
      await sends
        .getByRole('button', { name: 'Check status', exact: true })
        .click();
      did('AC-106');
      await expect
        .poll(async () =>
          (await sentMessages(mailbox)).map((message) => message.subject)
        )
        .toEqual(['Held numbers']);
      await expect(sends).toHaveCount(0);
    });
  });
}
