import { expect, type Page, test } from '@playwright/test';

const CARD = { name: 'Trial outreach' } as const;

// A cold Vite server compiles the app's shared modules for the first page.
test.setTimeout(120_000);

async function open(page: Page, query = '') {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route(/^http:\/\/localhost:\d+\//, async (route) => {
    await route.fulfill({ response: await route.fetch({ maxRetries: 2 }) });
  });
  await page.route('**/__macro_dev/**', (route) => route.abort());
  // Local container network changes can cancel Vite's initial module requests.
  // Retry only that startup failure, never an interaction.
  let networkChanged = false;
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED')
      networkChanged = true;
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    networkChanged = false;
    await page.goto(
      `/src/features/crm/browser-test/pipeline-card.html${query}`
    );
    await page.waitForLoadState('networkidle');
    if (!networkChanged) break;
  }
  const card = page.getByRole('article', CARD);
  await expect(card).toBeVisible({ timeout: 30000 });
  return card;
}

type RowLayout = {
  field: string;
  top: number;
  height: number;
  labelLeft: number;
  labelWidth: number;
  labelBottom: number;
  labelMiddle: number;
  /** Where the value's own content starts, inside the cell's padding. */
  valueLeft: number;
  valueTop: number;
  valueMiddle: number;
};

/** Each listed field's label and value boxes, top to bottom. */
function rows(page: Page): Promise<RowLayout[]> {
  return page.evaluate(() => {
    const contentLeft = (display: Element) => {
      // A pill's edge is where its value starts, not the dot inside it.
      const pill = display.querySelector('[data-slot="badge"]');
      if (pill) return pill.getBoundingClientRect().left;
      const lefts: number[] = [];
      const walker = document.createTreeWalker(
        display,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node instanceof Text) {
          if (!node.data.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getClientRects()[0];
          if (rect?.width) lefts.push(rect.left);
        } else if (node instanceof Element && node.childElementCount === 0) {
          const rect = node.getBoundingClientRect();
          if (rect.width && rect.height) lefts.push(rect.left);
        }
      }
      return Math.min(...lefts);
    };
    return [...document.querySelectorAll<HTMLElement>('[data-field]')].map(
      (row) => {
        const [label, value] = [...row.children];
        const display = value?.querySelector('[data-cell-display]');
        if (!label || !value || !display)
          throw new Error(`${row.dataset.field} has no label or value`);
        const rowBox = row.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        const displayBox = display.getBoundingClientRect();
        return {
          field: row.dataset.field ?? '',
          top: rowBox.top,
          height: rowBox.height,
          labelLeft: labelBox.left,
          labelWidth: labelBox.width,
          labelBottom: labelBox.bottom,
          labelMiddle: labelBox.top + labelBox.height / 2,
          valueLeft: contentLeft(display),
          valueTop: displayBox.top,
          valueMiddle: displayBox.top + displayBox.height / 2,
        };
      }
    );
  });
}

/** The email cut to one line, its link inline up to the box that ends it in an ellipsis. */
function emailLine(page: Page) {
  return page.evaluate(() => {
    const link = document.querySelector('[data-field="primary-email"] a');
    if (!link) throw new Error('The email is not a link');
    let box = link.parentElement;
    let inline = true;
    while (box && getComputedStyle(box).textOverflow !== 'ellipsis') {
      inline &&= getComputedStyle(box).display === 'inline';
      box = box.parentElement;
    }
    // A cut line breaks into fragments (shown text, hidden text, ellipsis) on one line.
    const tops = [...link.getClientRects()].map((rect) => Math.round(rect.top));
    return {
      lines: new Set(tops).size,
      cut: box ? box.scrollWidth > box.clientWidth : false,
      ellipsis: Boolean(box) && inline,
    };
  });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 768, height: 1600 } });

  test('lists fields as one label column with every value on one edge', async ({
    page,
  }) => {
    const card = await open(page);
    await expect(card.locator('[data-field]')).toHaveCount(6);
    await card.getByRole('button', { name: 'Show 15 more' }).click();
    await expect(card.locator('[data-field]')).toHaveCount(17);
    await expect(
      card.getByRole('button', {
        name: '4 empty fields: Trial ends, Notes, LinkedIn, Last outreach',
      })
    ).toBeVisible();

    const listed = await rows(page);
    const valueEdge = listed[0]!.labelLeft + 168 + 12;
    for (const row of listed) {
      expect(row.labelWidth, row.field).toBe(168);
      expect(row.labelLeft, row.field).toBe(listed[0]!.labelLeft);
      expect(Math.abs(row.valueLeft - valueEdge), row.field).toBeLessThan(1.5);
      expect(row.height, row.field).toBeGreaterThanOrEqual(32);
    }
    for (const field of ['status', 'pinned', 'score', 'contact-on', 'plan'])
      expect(listed.find((row) => row.field === field)?.height, field).toBe(32);
    // A person's avatar line is taller than text; its label stays level with it.
    const owner = listed.find((row) => row.field === 'owner');
    expect(
      Math.abs((owner?.labelMiddle ?? 0) - (owner?.valueMiddle ?? 0))
    ).toBe(0);

    // A draft keeps its paragraphs, one under the other.
    const paragraphs = card.locator('[data-field="draft"] p');
    await expect(paragraphs).toHaveCount(4);
    const first = await paragraphs.nth(0).boundingBox();
    const second = await paragraphs.nth(1).boundingBox();
    expect(second!.y - (first!.y + first!.height)).toBe(8);

    expect(await emailLine(page)).toEqual({
      lines: 1,
      cut: false,
      ellipsis: true,
    });
  });

  test('opens the empty fields in place and folds them away again', async ({
    page,
  }) => {
    const card = await open(page);
    await card.getByRole('button', { name: 'Show 15 more' }).click();
    const fold = card.getByRole('button', { name: /^4 empty fields/ });
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(card.locator('[data-field]')).toHaveCount(21);
    await expect(fold).toHaveCount(0);
    await expect(
      card.getByRole('button', { name: /^Notes: Empty\. Click to edit$/ })
    ).toBeVisible();
    await expect(
      card.locator('[data-field="trial-ends"] [data-cell-display]')
    ).toBeFocused();

    await card.getByRole('button', { name: 'Show less' }).click();
    await expect(card.locator('[data-field]')).toHaveCount(6);
    await expect(card).toBeInViewport();
  });

  test('edits a value in place through the grid cell', async ({ page }) => {
    const card = await open(page);
    await card.getByRole('button', { name: 'Show 15 more' }).click();
    await card.getByRole('button', { name: /^First name: Marisol/ }).click();
    const editor = card.getByRole('textbox', { name: 'Edit First name' });
    await editor.fill('Mari');
    await editor.press('Tab');
    await expect(page.getByLabel('Pipeline writes')).toHaveText('1');
    await expect(
      card.getByRole('button', { name: /^First name: Mari\./ })
    ).toBeVisible();

    await card.getByRole('button', { name: /^Status: Skipped/ }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
  });

  test('a pipeline the viewer cannot edit lists its values read-only', async ({
    page,
  }) => {
    const card = await open(page, '?editable=false');
    await card.getByRole('button', { name: 'Show 15 more' }).click();
    const name = card.getByRole('button', { name: /^First name: Marisol/ });
    await expect(name).toHaveAttribute('aria-readonly', 'true');
    await name.click();
    await expect(card.getByRole('textbox')).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 1800 },
    hasTouch: true,
    isMobile: true,
  });

  test('puts prose under its label and keeps short values beside theirs', async ({
    page,
  }) => {
    const card = await open(page);
    await card.getByRole('button', { name: 'Show 15 more' }).tap();
    await expect(card.locator('[data-field]')).toHaveCount(17);

    const listed = await rows(page);
    const labelLeft = listed[0]!.labelLeft;
    const valueEdge = labelLeft + 116 + 10;
    for (const row of listed) {
      if (['why', 'history', 'draft', 'auto-draft'].includes(row.field)) {
        expect(row.valueTop, row.field).toBeGreaterThanOrEqual(
          row.labelBottom - 4
        );
        expect(Math.abs(row.valueLeft - labelLeft), row.field).toBeLessThan(
          1.5
        );
        continue;
      }
      expect(row.labelWidth, row.field).toBe(116);
      expect(Math.abs(row.valueLeft - valueEdge), row.field).toBeLessThan(1.5);
      expect(row.height, row.field).toBeGreaterThanOrEqual(32);
      expect(row.labelMiddle, row.field).toBe(row.valueMiddle);
    }

    expect(await emailLine(page)).toEqual({
      lines: 1,
      cut: true,
      ellipsis: true,
    });
  });
});
