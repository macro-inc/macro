import { type CDPSession, expect, type Page, test } from '@playwright/test';

type RowPaint = {
  name: string;
  /** Elements between the name and the sheet that paint a background. */
  painted: string[];
  /** Opacity of each swipe action icon behind the row. */
  icons: string[];
};

/** What lies between each entry's name and the sheet behind it. */
function rowPaint(page: Page): Promise<RowPaint[]> {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-corvu-drawer-content]');
    if (!sheet) throw new Error('no sheet');
    const names = [...sheet.querySelectorAll('section span')].filter((span) =>
      /^(Ada|Ben) Example$/.test(span.textContent ?? '')
    );
    return names.map((name) => {
      const painted: string[] = [];
      for (
        let element = name.parentElement;
        element && element !== sheet;
        element = element.parentElement
      ) {
        const background = getComputedStyle(element).backgroundColor;
        if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent')
          painted.push(`${element.tagName.toLowerCase()} ${background}`);
      }
      const swipe = name.closest('[data-swipe-row]');
      const icons = swipe
        ? [
            ...swipe.querySelectorAll(
              '[data-left-reveal] svg, [data-right-reveal] svg'
            ),
          ].map((icon) => getComputedStyle(icon).opacity)
        : [];
      return { name: name.textContent ?? '', painted, icons };
    });
  });
}

/** Every entry shows the sheet through it, with no swipe action showing. */
/** Each entry of the list (the fixture keeps a deleted one), and whether it rests. */
async function expectAtRest(page: Page) {
  await expect
    .poll(async () =>
      (await rowPaint(page))
        .map(
          (row) =>
            `${row.name}: ${
              row.painted.length === 0 &&
              row.icons.every((icon) => icon === '0')
                ? 'at rest'
                : 'painted'
            }`
        )
        .sort()
    )
    .toEqual([
      'Ada Example: at rest',
      'Ada Example: at rest',
      'Ben Example: at rest',
    ]);
}

/** The fill of the sliding content of the row holding `text`, as a 0–1 alpha. */
function contentAlpha(page: Page, text: string): Promise<number> {
  return page
    .locator('[data-swipe-row]', { hasText: text })
    .locator('[data-swipe-content]')
    .evaluate((content) => {
      const probe = document.createElement('canvas').getContext('2d');
      if (!probe) throw new Error('no canvas');
      probe.fillStyle = getComputedStyle(content).backgroundColor;
      probe.fillRect(0, 0, 1, 1);
      return (probe.getImageData(0, 0, 1, 1).data[3] ?? 0) / 255;
    });
}

async function rowCenter(page: Page, text: string) {
  const box = await page
    .locator('[data-swipe-row]', { hasText: text })
    .boundingBox();
  if (!box) throw new Error(`no row for ${text}`);
  return { x: box.x, y: box.y + box.height / 2, width: box.width };
}

/** A finger on the row holding `text`, moved by `distance` and held there. */
async function drag(
  cdp: CDPSession,
  page: Page,
  text: string,
  distance: number
) {
  const row = await rowCenter(page, text);
  const startX = distance > 0 ? row.x + 40 : row.x + row.width - 40;
  const touch = (type: 'touchStart' | 'touchMove', x: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [{ x, y: row.y, id: 1 }],
    });
  await touch('touchStart', startX);
  for (let step = 1; step <= 12; step++)
    await touch('touchMove', startX + (distance * step) / 12);
}

function release(cdp: CDPSession) {
  return cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      const sheet = page.locator('[data-corvu-drawer-content]');
      await expect(sheet).toBeInViewport({ ratio: 1 });
      await expect(sheet).not.toHaveAttribute('data-transitioning');
      await expect(page.getByText('Ben Example')).toBeVisible();
    });

    test('every entry sits on the sheet at rest, with no swipe action showing', async ({
      page,
    }) => {
      await expectAtRest(page);
    });

    test('a swiped entry fills over its actions while it moves, and opens to edit', async ({
      page,
    }) => {
      const cdp = await page.context().newCDPSession(page);
      await drag(cdp, page, 'Review', 180);
      expect(await contentAlpha(page, 'Review')).toBe(1);
      const dragged = (await rowPaint(page)).filter((entry) =>
        entry.icons.includes('1')
      );
      expect(dragged).toHaveLength(1);

      await release(cdp);
      await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue(
        'Review'
      );
    });

    test('an entry let go short of an action, or swiped to delete, returns to rest', async ({
      page,
    }) => {
      const cdp = await page.context().newCDPSession(page);
      await drag(cdp, page, 'Review', 30);
      expect(await contentAlpha(page, 'Review')).toBe(1);
      await release(cdp);
      await expectAtRest(page);

      await drag(cdp, page, '15m', -220);
      expect(await contentAlpha(page, '15m')).toBe(1);
      await release(cdp);
      await expectAtRest(page);
    });
  });
}
