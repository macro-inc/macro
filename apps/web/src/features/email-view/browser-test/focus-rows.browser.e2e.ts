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
  'due-soon': 'Reply needed',
  'due-today': 'Follow up',
  'due-tomorrow': 'Contact',
  overdue: 'Reply needed',
  'due-no-reason': undefined,
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
  await expect(page.getByTestId('row-due-no-reason')).toBeVisible({
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
      expect(await rowHeight('due-soon')).toBe(await rowHeight('other'));
      if (size.touch)
        expect(await rowHeight('reply')).toBeGreaterThanOrEqual(44);

      // Stacked rows have the subject's own line: the pill can't take from it.
      if (size.stacked) {
        expect(await subjectWidth('reply')).toBe(await subjectWidth('other'));
      }
      // One-line rows keep a readable subject beside the widest pills.
      else expect(await subjectWidth('due-soon')).toBeGreaterThanOrEqual(200);

      const horizontalOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      );
      expect(horizontalOverflow).toBe(false);
    });

    test('a due date shows beside the reason, on both sorts', async ({
      page,
    }) => {
      await open(page);
      const pill = (id: string, label: string | RegExp) =>
        page.getByTestId(`row-${id}`).getByText(label, { exact: true });

      for (const sort of ['Most recent', 'Importance']) {
        await page.getByRole('button', { name: sort }).click();
        await expect(
          pill('due-soon', /^Due (Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/)
        ).toBeVisible();
        await expect(pill('due-today', 'Due today')).toBeVisible();
        await expect(pill('due-tomorrow', 'Due tomorrow')).toBeVisible();
        await expect(pill('overdue', 'Overdue')).toBeVisible();
        await expect(
          pill('due-no-reason', /^Due [A-Z][a-z]{2} \d{1,2}(, \d{4})?$/)
        ).toBeVisible();
        await expect(
          page.getByTestId('row-reply').getByText(/^(Due|Overdue)/)
        ).toHaveCount(0);
      }

      // The warning tone sets an overdue row apart from one that is only due.
      const border = (id: string, label: string | RegExp) =>
        pill(id, label).evaluate((node) => getComputedStyle(node).borderColor);
      expect(await border('overdue', 'Overdue')).not.toBe(
        await border('due-today', 'Due today')
      );
    });

    test('the meter shows only under the importance sort, in its band color', async ({
      page,
    }) => {
      await open(page);
      const meters = page.getByRole('img', {
        name: /^Importance \d+ of 100(, (rising|falling))?$/,
      });
      await expect(meters).toHaveCount(0);

      await page.getByRole('button', { name: 'Importance' }).click();
      await expect(meters).toHaveCount(Object.keys(REASONS).length);
      const reply = page.getByTestId('row-reply');
      await expect(
        reply.getByRole('img', { name: 'Importance 92 of 100, rising' })
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

    test('the label says which way importance is moving, with no icon', async ({
      page,
    }) => {
      await open(page);
      await page.getByRole('button', { name: 'Importance' }).click();
      const labels: Record<string, string> = {
        reply: 'Importance 92 of 100, rising',
        'follow-up': 'Importance 71 of 100, falling',
        contact: 'Importance 22 of 100',
        // A trend from a newer server reads as flat.
        unknown: 'Importance 2 of 100',
      };
      for (const [id, label] of Object.entries(labels)) {
        const meter = page
          .getByTestId(`row-${id}`)
          .getByRole('img', { name: label, exact: true });
        await expect(meter).toBeVisible();
        await expect(meter.locator('svg')).toHaveCount(0);
      }

      // The tooltip says the same. Touch has no tooltips.
      if (!size.touch) {
        await page
          .getByTestId('row-follow-up')
          .getByRole('img', { name: 'Importance 71 of 100, falling' })
          .hover();
        await expect(page.getByRole('tooltip')).toHaveText(
          'Importance 71 of 100, falling'
        );
      }
    });
  });
}
