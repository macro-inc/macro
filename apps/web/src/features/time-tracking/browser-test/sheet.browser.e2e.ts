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

async function rowCenter(page: Page, text: string) {
  const box = await page
    .locator('[data-swipe-row]', { hasText: text })
    .boundingBox();
  if (!box) throw new Error(`no row for ${text}`);
  return { x: box.x, y: box.y + box.height / 2, width: box.width };
}

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove',
  x: number,
  y: number
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [{ x, y, id: 1 }],
  });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await expect(page.getByText('Ben Example')).toBeVisible();
    });

    test('every entry sits on the sheet at rest, with no swipe action showing', async ({
      page,
    }) => {
      const rows = await rowPaint(page);
      expect(rows.map((row) => row.name).sort()).toEqual([
        'Ada Example',
        'Ada Example',
        'Ben Example',
      ]);
      for (const row of rows) {
        expect(row.painted, row.name).toEqual([]);
        for (const opacity of row.icons) expect(opacity, row.name).toBe('0');
      }
    });

    test('a swiped entry covers its actions until it reveals one, and still opens to edit', async ({
      page,
    }) => {
      const cdp = await page.context().newCDPSession(page);
      const row = await rowCenter(page, 'Review');
      await touch(cdp, 'touchStart', row.x + 40, row.y);
      for (let step = 1; step <= 12; step++)
        await touch(cdp, 'touchMove', row.x + 40 + step * 15, row.y);

      const dragged = (await rowPaint(page)).filter(
        (entry) => entry.painted.length > 0
      );
      expect(dragged).toHaveLength(1);
      expect(dragged[0]?.icons).toContain('1');

      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue(
        'Review'
      );
    });
  });
}
