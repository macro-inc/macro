import { expect, type Page, test } from '@playwright/test';

const deliverJoinRequests = (page: Page) =>
  page.evaluate(() => window.calendarPreview.deliverJoinRequests());

async function openDetails(page: Page, query: string) {
  await page.goto(`/?${query}`);
  const anchor = page.getByRole('button', {
    name: 'Planning review',
    exact: true,
  });
  await anchor.click();
  const details = page.getByRole('dialog', { name: 'Planning review' });
  await expect(details).toBeVisible();
  // Kobalte places the popover after it mounts; wait until it is beside the anchor.
  await expect
    .poll(async () => (await details.boundingBox())?.x ?? 0)
    .toBeGreaterThan(((await anchor.boundingBox())?.x ?? 0) + 1);
  return { anchor, details };
}

async function box(locator: ReturnType<Page['getByRole']>) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('Expected a laid-out element');
  return { ...rect, bottom: rect.y + rect.height };
}

test.describe('desktop popover', () => {
  test.skip(({ isMobile }) => isMobile, 'The phone shows a drawer');

  test.describe('tall window', () => {
    test.use({ viewport: { width: 1280, height: 1000 } });

    test('stays below the event when join requests arrive after opening', async ({
      page,
    }) => {
      const loaded = await openDetails(page, 'requests=loaded');
      const withRequests = (await box(loaded.details)).height;
      const pending = await openDetails(page, '');
      const opened = await box(pending.details);
      const withoutRequests = opened.height;
      // Where a start-aligned popover sits relative to its event's top.
      const startOffset = opened.y - (await box(pending.anchor)).y;
      expect(withRequests).toBeGreaterThan(withoutRequests + 40);

      // Put the event where the popover fits below it until the requests
      // arrive, with room above for the whole grown popover.
      const top = Math.round(1000 - 8 - (withRequests + withoutRequests) / 2);
      const { anchor, details } = await openDetails(page, `top=${top}`);
      const event = await box(anchor);
      expect(event.bottom).toBeGreaterThan(withRequests + 16);
      const before = await box(details);
      expect(Math.abs(before.y - event.y - startOffset)).toBeLessThanOrEqual(1);

      await deliverJoinRequests(page);
      await expect(
        details.getByRole('region', { name: 'Requests to join' })
      ).toBeVisible();
      await expect
        .poll(async () => Math.abs((await box(details)).height - withRequests))
        .toBeLessThan(2);
      const after = await box(details);
      // It slides up by what no longer fits instead of flipping above the event.
      expect(before.y - after.y).toBeLessThanOrEqual(
        after.height - before.height + 1
      );
      expect(after.bottom).toBeGreaterThan(event.bottom + 1);
      expect(after.bottom).toBeLessThanOrEqual(1000);
      await expect(
        details.getByRole('button', { name: 'Add as guest', exact: true })
      ).toBeInViewport({ ratio: 1 });
    });
  });

  test.describe('short window', () => {
    test.use({ viewport: { width: 1280, height: 560 } });

    test('slides the popover into view beside an event near the bottom', async ({
      page,
    }) => {
      const { anchor, details } = await openDetails(
        page,
        'requests=loaded&top=470'
      );
      const event = await box(anchor);
      const popover = await box(details);
      expect(popover.y).toBeGreaterThanOrEqual(0);
      expect(popover.bottom).toBeLessThanOrEqual(560);
      expect(popover.x).toBeGreaterThanOrEqual(event.x + event.width);
      await expect(
        details.getByRole('button', { name: 'Close event details' })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        details.getByRole('button', { name: 'Add as guest', exact: true })
      ).toBeInViewport({ ratio: 1 });
    });
  });
});

test('the phone drawer shows join requests that arrive after it opens', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Desktop shows a popover');
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Planning review', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Planning review' });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole('region', { name: 'Requests to join' })
  ).toHaveCount(0);

  await deliverJoinRequests(page);
  const requests = drawer.getByRole('region', { name: 'Requests to join' });
  await expect(requests).toBeVisible();
  await requests
    .getByRole('button', { name: 'Add as guest', exact: true })
    .click();
  // The modal drawer hides the page behind it from the accessibility tree.
  await expect(page.locator('[aria-label="Preview action"]')).toHaveText(
    'Invited member@example.com'
  );
  await expect(requests).toHaveCount(0);
});
