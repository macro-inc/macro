import { expect, type Page, test } from '@playwright/test';

const REASONS: Record<string, string | undefined> = {
  reply: 'Reply needed',
  'follow-up': 'Follow up',
  both: 'Reply needed',
  calendar: 'Calendar change',
  customer: 'Customer',
  team: 'Teammate',
  contact: 'Contact',
  other: undefined,
  unknown: undefined,
};
const ALL_REASONS = [
  'Reply needed',
  'Follow up',
  'Calendar change',
  'Customer',
  'Teammate',
  'Contact',
];

const WIDTHS = [
  { name: 'wide row', width: 1280, height: 800, touch: false, stacked: false },
  // The narrowest row that keeps the subject and reason on one line.
  {
    name: 'one-line row',
    width: 640,
    height: 800,
    touch: false,
    stacked: false,
  },
  { name: 'stacked row', width: 639, height: 800, touch: false, stacked: true },
  { name: 'narrow row', width: 420, height: 800, touch: false, stacked: true },
  { name: 'phone', width: 390, height: 844, touch: true, stacked: true },
  { name: 'tablet', width: 820, height: 1180, touch: true, stacked: false },
];

async function open(page: Page) {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // The dev server proxies this prefix to the hosted dev backend.
    if (
      url.hostname !== 'localhost' ||
      url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.abort();
      return;
    }
    // Served from Node: a Docker network change on a shared machine aborts
    // Chrome's own in-flight requests, and a dev page load makes thousands.
    await route.fulfill({ response: await route.fetch() });
  });
  await page.goto('/src/features/email-view/browser-test/focus-rows.html');
  await expect(page.getByTestId('row-unknown')).toBeVisible({
    timeout: 180_000,
  });
}

// A route still fetching as a test ends must not fail it.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const size of WIDTHS) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
      isMobile: size.touch && size.width < 640,
    });

    test('every row shows its one reason, on one line', async ({ page }) => {
      await open(page);
      for (const [id, reason] of Object.entries(REASONS)) {
        const row = page.getByTestId(`row-${id}`);
        for (const label of ALL_REASONS) {
          const pill = row.getByText(label, { exact: true });
          if (label === reason) await expect(pill).toBeVisible();
          else await expect(pill).toHaveCount(0);
        }
      }
    });

    test('the reason leaves the row and its subject their room', async ({
      page,
    }) => {
      await open(page);
      const rowHeight = async (id: string) => {
        const box = await page.getByTestId(`row-${id}`).boundingBox();
        if (!box) throw new Error(`Row ${id} has no box`);
        return box.height;
      };
      const subjectWidth = async (id: string) => {
        const box = await page
          .getByTestId(`row-${id}`)
          .getByText(/^A subject long enough/)
          .boundingBox();
        if (!box) throw new Error(`Row ${id} has no subject`);
        return box.width;
      };

      // A pill adds no height, whatever the row's layout.
      expect(await rowHeight('reply')).toBe(await rowHeight('other'));
      if (size.touch)
        expect(await rowHeight('reply')).toBeGreaterThanOrEqual(44);

      // Stacked rows have the subject's own line: the pill can't take from it.
      if (size.stacked) {
        expect(await subjectWidth('reply')).toBe(await subjectWidth('other'));
      }
      // One-line rows keep a readable subject beside the widest pill.
      else expect(await subjectWidth('reply')).toBeGreaterThanOrEqual(200);

      const horizontalOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      );
      expect(horizontalOverflow).toBe(false);
    });

    test('the meter shows only under the importance sort, in its band color', async ({
      page,
    }) => {
      await open(page);
      const meters = page.getByRole('img', { name: /^Importance \d+ of 100$/ });
      await expect(meters).toHaveCount(0);

      await page.getByRole('button', { name: 'Importance' }).click();
      await expect(meters).toHaveCount(Object.keys(REASONS).length);
      const reply = page.getByTestId('row-reply');
      await expect(
        reply.getByRole('img', { name: 'Importance 92 of 100' })
      ).toBeVisible();
      await expect(reply).toContainText('92');

      // Each band has its own color; the lowest score leaves the first bar unlit.
      const firstBarColors = await page.evaluate(() => {
        const colors = new Set<string>();
        for (const meter of document.querySelectorAll(
          '[role="img"][aria-label^="Importance"]'
        )) {
          const first = meter.lastElementChild?.firstElementChild;
          if (first) colors.add(getComputedStyle(first).backgroundColor);
        }
        return [...colors];
      });
      expect(firstBarColors).toHaveLength(6);

      await page.getByRole('button', { name: 'Most recent' }).click();
      await expect(meters).toHaveCount(0);
    });
  });
}
