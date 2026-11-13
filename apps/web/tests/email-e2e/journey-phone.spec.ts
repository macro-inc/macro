// Journey: mail on a phone. The list, a thread tapped open, a reply written
// in the phone's composer and sent, and a row swiped away as done. The same
// journey for a Gmail and an Outlook inbox.

import { devices, type Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import type { Provider } from './harness/stack';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

/** Swipes a row of the list to the left with a finger, as far as `distance`. */
async function swipeLeft(
  page: Page,
  threadId: string,
  distance: number
): Promise<void> {
  const surface = page.locator(
    `[data-swipe-id="${threadId}"] [data-swipe-surface]`
  );
  // The touches go to fixed points: wait until the row stops moving (the
  // list slides back in after a thread is closed).
  let box = await surface.boundingBox();
  await expect
    .poll(async () => {
      const next = await surface.boundingBox();
      const still =
        next !== null && box !== null && next.x === box.x && next.y === box.y;
      box = next;
      return still;
    })
    .toBe(true);
  if (!box) throw new Error(`no row for ${threadId}`);
  const y = box.y + box.height / 2;
  const start = box.x + box.width - 60;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start, y }],
  });
  for (let moved = 10; moved <= distance; moved += 30) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start - moved, y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`mail on a phone, ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a reply written on a phone does not reach the sender, or
    // a swiped row is not marked done at the provider.
    test('open a thread, reply from the phone composer, swipe a row to done', async ({
      page,
      mailbox,
    }) => {
      const grace = 'grace@example.com';
      await addMailbox(mailbox, grace);
      await mailbox.deliver({
        from: `Grace <${grace}>`,
        subject: 'Lunch?',
        text: 'Noon at the usual place?',
      });
      await mailbox.deliver({
        from: 'Ida <ida@example.com>',
        subject: 'Weekly report',
        text: 'This week in numbers.',
      });
      await mailbox.synced('Lunch?');
      const report = await mailbox.synced('Weekly report');

      await mailbox.open();
      // The phone layout, not a desktop one squeezed by touch emulation.
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        phone.viewport.width
      );
      const list = page.getByRole('grid', { name: 'Email' });
      await expect(list.getByText('Weekly report')).toBeVisible();
      await list.getByText('Lunch?').tap();
      await expect(page.getByText('Noon at the usual place?')).toBeVisible();

      await page
        .locator('[data-mobile-dock-island]')
        .getByRole('button', { name: 'Reply', exact: true })
        .tap();
      const composer = page.getByRole('dialog', { name: 'Reply composer' });
      const editor = composer.getByRole('textbox', { name: /reference files/ });
      await editor.tap();
      await editor.pressSequentially('Works for me.');
      await composer.getByRole('button', { name: 'Send email' }).tap();
      await expect(composer).toHaveCount(0);
      await expect
        .poll(async () =>
          (await readMailbox(mailbox, grace)).map((message) => message.subject)
        )
        .toEqual(['Re: Lunch?']);
      const [reply] = await readMailbox(mailbox, grace);
      expect(reply.html).toContain('Works for me.');

      await page.getByRole('button', { name: 'Go Back' }).tap();
      await expect(list.getByText('Weekly report')).toBeVisible();
      await swipeLeft(page, report.id, 160);
      await expect(list.getByText('Weekly report')).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await mailbox.providerMessages()).find(
              (message) => message.subject === 'Weekly report'
            )?.inInbox
        )
        .toBe(false);
    });
  });
}
