// A thread that could not be loaded: the Retry under "Unable to load this
// email" loads it once the service answers again.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { deliverEach } from './harness/ways-thread';
import { did } from './ledger/record';

// The thread is read from Macro's own store, whichever mailbox it came
// from. Gmail only.
test.describe('a thread that fails to load', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a thread whose load failed stays on its error: Retry
  // does not ask for the thread again.
  test('Retry loads the thread after a failed load', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverEach(mailbox, ['Agenda']);
    // The thread's own request fails until the test lets it through: over
    // GraphQL the request names the thread in its variables, over REST in
    // its path.
    let failing = true;
    await page.route(/\/graphql(\?|$)|\/email\/threads\//, (route) => {
      const request = route.request();
      const names =
        request.url().includes(ids.Agenda) ||
        (request.postData() ?? '').includes(ids.Agenda);
      if (!failing || !names) return route.fallback();
      return route.fulfill({ status: 500, body: 'unavailable' });
    });

    await mailbox.open(`/app/mail/${ids.Agenda}`);
    await expect(page.getByText('Unable to load this email')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('About Agenda.')).toHaveCount(0);

    failing = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    did('AL-191');
    await expect(page.getByText('About Agenda.').first()).toBeVisible();
    await expect(page.getByText('Unable to load this email')).toHaveCount(0);
  });
});
