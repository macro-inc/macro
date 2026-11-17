// What an open thread shows while it loads: the error with Retry when its
// load fails, a message's header details and the tooltips of their caret,
// and "Loading messages" while a long thread loads its older page.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import {
  headerCaret,
  holdOperation,
  longPoints,
} from './harness/states-thread';
import { deliverThread, messageCard, threadMessages } from './harness/thread';
import { allRead, openFromList, row } from './harness/ways-thread';
import { threadReadsInFlight } from './harness/ways-thread-more';
import { saw } from './ledger/record';

// The thread is read from Macro's own store and drawn by the same view,
// whichever mailbox it came from. Gmail only, on a desktop: the phone draws
// the same gate and leaves the details closed behind Info.
test.describe('an open thread loading', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a thread whose load failed shows no error with Retry
  // (or Retry does not load it), the caret beside a message's recipients
  // names no tooltip, or the details it opens lack the sender, a recipient
  // row or the message's full date.
  test('a failed load shows the error with Retry, then the header caret opens the details', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      to: `${mailbox.inbox.email}, Ada <ada@example.com>`,
      cc: 'Bob <bob@example.com>',
      subject: 'Agenda',
      text: 'About Agenda.',
    });
    const { id } = await mailbox.synced('Agenda');
    // The thread's own request fails until the test lets it through: over
    // GraphQL the request names the thread in its variables, over REST in
    // its path.
    let failing = true;
    await page.route(/\/graphql(\?|$)|\/email\/threads\//, (route) => {
      const request = route.request();
      const names =
        request.url().includes(id) || (request.postData() ?? '').includes(id);
      if (!failing || !names) return route.fallback();
      return route.fulfill({ status: 500, body: 'unavailable' });
    });

    await mailbox.open(`/app/mail/${id}`);
    await expect(page.getByText('Unable to load this email')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByText('Check your internet connection and try again.')
    ).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    saw('STL-067');
    await expect(page.getByText('About Agenda.')).toHaveCount(0);
    failing = false;
    await retry.click();
    await expect(page.getByText('About Agenda.').first()).toBeVisible();

    const card = messageCard(page, 'About Agenda.');
    const caret = headerCaret(card);
    await caret.hover();
    await expect(page.getByText('Expand Message Header')).toBeVisible();
    await caret.click();
    const detail = (label: string) =>
      card
        .locator('div.flex-row')
        .filter({ has: page.getByText(label, { exact: true }) })
        .last();
    await expect(detail('From')).toContainText('grace@example.com');
    await expect(detail('To')).toContainText('ada@example.com');
    await expect(detail('Cc')).toContainText('bob@example.com');
    // The full date, as the browser writes it in the app's own format.
    const [message] = await threadMessages(mailbox, id);
    const full = await page.evaluate(
      (date) =>
        new Date(date)
          .toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
          })
          .replace(',', ''),
      String(message.internal_date_ts)
    );
    await expect(card.getByText(full, { exact: true })).toBeVisible();
    saw('STL-087');
    await page.mouse.move(0, 0);
    await caret.hover();
    await expect(page.getByText('Collapse Message Header')).toBeVisible();
    saw('STL-089');
  });

  // When this fails, a long thread loading its older messages shows nothing
  // above the reply area of its last message, or "Loading messages" stays
  // there once they are loaded.
  test('"Loading messages" shows while a long thread loads its older page', async ({
    page,
    mailbox,
  }) => {
    const thread = await deliverThread(mailbox, 'Long plan', longPoints(21), {
      aSecondApart: true,
    });
    const reads = threadReadsInFlight(page);
    await mailbox.open();
    // Read once, so that it opens again at its latest message.
    await openFromList(page, thread.id, 'Point number 21 of the plan.');
    await allRead(mailbox, thread.id);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/mail$/);
    await row(page, thread.id).click();
    const cards = messageCard(page, 'Point number');
    await expect(
      page.getByRole('button', { name: 'Show 17 hidden messages' })
    ).toBeVisible();
    await expect.poll(reads).toBe(0);
    // The loader is always on the page, hidden until the thread fetches.
    const loader = page.getByText('Loading messages').locator('xpath=../..');
    await expect(loader).toHaveClass(/opacity-0/);

    // The older page is held until the loader has been seen.
    const older = await holdOperation(
      page,
      'EmailThreadPage',
      (body) => !/"offset":0\b/.test(body)
    );
    await cards.last().hover();
    await page.mouse.wheel(0, -200_000);
    await expect.poll(older.held).toBeGreaterThan(0);
    await expect(loader).toHaveClass(/opacity-100/);
    await expect(loader).toBeVisible();
    saw('STL-068');
    await older.release();
    await expect(
      page.getByRole('button', { name: 'Show 18 hidden messages' })
    ).toBeVisible();
    // It says done, then leaves.
    await expect(page.getByText('Loading messages')).toBeHidden();
  });
});
