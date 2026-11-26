import { expect, type Locator, type Page, test } from '@playwright/test';
import { ENTITY_NAMES } from './stubs/entities';

const FIXTURE = '/src/features/routines/browser-test/knobs.html';
const ALERT = /^Alert: insight 'GraphQL soup/;

const WIDTHS = [
  { name: 'desktop', viewport: { width: 1200, height: 900 }, touch: false },
  // A narrow split pane on desktop: no touch, and the sm: breakpoint unmet.
  {
    name: 'narrow desktop',
    viewport: { width: 560, height: 900 },
    touch: false,
  },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
];

type Box = { left: number; right: number };

/** Where a box starts and ends across, to the pixel. */
async function across(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { left, right } = element.getBoundingClientRect();
    return { left: Math.round(left), right: Math.round(right) };
  });
}

/** Whether a name is wider than its box shows. */
function isClipped(locator: Locator) {
  return locator.evaluate(
    (element) => element.scrollWidth > element.clientWidth
  );
}

/** Whether a name is cut short, hiding the rest, and ends in an ellipsis. */
function endsInEllipsis(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      element.scrollWidth > element.clientWidth &&
      style.overflowX !== 'visible' &&
      style.textOverflow === 'ellipsis'
    );
  });
}

/** How many lines a piece of text takes. */
function textLines(locator: Locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = [...range.getClientRects()].map((rect) =>
      Math.round(rect.top)
    );
    return new Set(tops).size;
  });
}

/** Every value a step's sentence or settings show, with what it reads. */
async function knobBoxes(card: Locator) {
  return card.locator('p [aria-label], dd [aria-label]').evaluateAll((values) =>
    values.map((value) => {
      const { left, right } = value.getBoundingClientRect();
      return {
        label: value.getAttribute('aria-label') ?? '',
        left: Math.round(left),
        right: Math.round(right),
      };
    })
  );
}

/** How many lines a sentence's items sit on, and the most on any one line. */
async function itemLines(sentence: Locator) {
  return sentence.locator('[aria-label]').evaluateAll((items) => {
    const middles = items
      .map((item) => {
        const { top, bottom } = item.getBoundingClientRect();
        return (top + bottom) / 2;
      })
      .sort((a, b) => a - b);
    const lines: number[][] = [];
    for (const middle of middles) {
      const line = lines.at(-1);
      // Items on one line share their middle to within a few pixels.
      if (line && middle - line[0] < 8) line.push(middle);
      else lines.push([middle]);
    }
    return {
      lines: lines.length,
      most: Math.max(...lines.map((line) => line.length)),
    };
  });
}

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(FIXTURE, { waitUntil: 'networkidle' });
  // The first visit pre-bundles the app's dependencies, which can take minutes.
  await expect(page.getByText('Echo entity knobs')).toBeVisible({
    timeout: 180_000,
  });
  await page.evaluate(() => document.fonts.ready);
  return { errors };
}

for (const width of WIDTHS) {
  test.describe(`at ${width.name} width`, () => {
    test.use({
      viewport: width.viewport,
      hasTouch: width.touch,
      isMobile: width.touch,
    });

    test('every picked item stays inside its step’s card', async ({ page }) => {
      const { errors } = await open(page);
      const cards = page.getByRole('group');
      await expect(cards).toHaveCount(3);
      for (const card of await cards.all()) {
        const edges = await across(card);
        // The card itself keeps to the page, rather than growing with its items.
        expect(edges.right).toBeLessThanOrEqual(width.viewport.width);
        const values = await knobBoxes(card);
        expect(values.length).toBeGreaterThan(0);
        for (const value of values) {
          expect(value.left, value.label).toBeGreaterThanOrEqual(edges.left);
          expect(value.right, value.label).toBeLessThanOrEqual(edges.right);
        }
      }
      // Nothing scrolls sideways.
      const pane = page.locator('#root > div');
      expect(
        await pane.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      expect(errors).toEqual([]);
    });

    test('a sentence of many items wraps within its card', async ({ page }) => {
      await open(page);
      const card = page.getByRole('group', { name: 'Echo entity knobs' });
      const sentence = card.locator('p').filter({ hasText: /^Read / });
      const edges = await across(card);
      const text = await across(sentence);
      expect(text.right).toBeLessThanOrEqual(edges.right);
      // On several lines, with short items side by side rather than one to a line.
      const { lines, most } = await itemLines(sentence);
      expect(lines).toBeGreaterThan(1);
      expect(most).toBeGreaterThanOrEqual(2);
      // Short names show whole.
      expect(
        await isClipped(sentence.getByText('product-launch').first())
      ).toBe(false);
    });

    test('a long item ends in an ellipsis inside the card', async ({
      page,
    }) => {
      await open(page);
      for (const name of ['Echo entity knobs', 'Summarize the alert']) {
        const card = page.getByRole('group', { name });
        const subject = card.locator('p').getByText(ALERT);
        const edges = await across(card);
        expect((await across(subject)).right).toBeLessThanOrEqual(edges.right);
        // Cut short, not wrapped onto more lines.
        expect(await endsInEllipsis(subject)).toBe(true);
      }
      // The comma after it stays on its line, not alone at the next one's start.
      const long = page
        .getByRole('group', { name: 'Echo entity knobs' })
        .locator('p')
        .getByText(ALERT);
      const after = await long.evaluate((element) => {
        const trigger = element.closest('[aria-label]')!;
        const walker = document.createTreeWalker(
          trigger.closest('p')!,
          NodeFilter.SHOW_TEXT
        );
        walker.currentNode = trigger;
        let text = walker.nextNode();
        while (text && trigger.contains(text)) text = walker.nextNode();
        const range = document.createRange();
        range.setStart(text!, 0);
        range.setEnd(text!, 1);
        const comma = range.getBoundingClientRect();
        const name = element.getBoundingClientRect();
        return {
          character: range.toString(),
          sameLine: comma.top < name.bottom && comma.bottom > name.top,
        };
      });
      expect(after).toEqual({ character: ',', sameLine: true });
    });

    test('a long item under Settings leaves its label room', async ({
      page,
    }) => {
      await open(page);
      const card = page.getByRole('group', { name: 'Post a digest' });
      const label = card.locator('dt').filter({ hasText: 'Alert thread' });
      const value = card.locator('dd').getByText(ALERT);
      const edges = await across(card);
      expect((await across(value)).right).toBeLessThanOrEqual(edges.right);
      expect(await endsInEllipsis(value)).toBe(true);
      // The label reads on one line beside its value.
      expect(await isClipped(label)).toBe(false);
      expect((await label.boundingBox())!.height).toBeLessThan(30);
      // A short value beside it shows whole.
      expect(
        await isClipped(card.locator('dd').getByText('Shared assets'))
      ).toBe(false);
    });

    test('a link under Settings breaks to fit its column', async ({ page }) => {
      await open(page);
      const card = page.getByRole('group', { name: 'Post a digest' });
      const column = card.locator('dd').filter({ hasText: /^https:/ });
      const link = column.getByText(/^https:/);
      const edges = await across(column);
      const box = await across(link);
      expect(box.left).toBeGreaterThanOrEqual(edges.left);
      expect(box.right).toBeLessThanOrEqual(edges.right);
      // At phone width the link, which has nowhere to break, is wider than
      // its column, so it breaks onto a second line rather than running out.
      if (width.touch) expect(await textLines(link)).toBeGreaterThan(1);
    });

    test('a cut name shows in full on hover', async ({ page }) => {
      test.skip(width.touch, 'Touch devices have no tooltips.');
      await open(page);
      const card = page.getByRole('group', { name: 'Summarize the alert' });
      await card.locator('p').getByText(ALERT).hover();
      await expect(page.getByRole('tooltip')).toHaveText(
        ENTITY_NAMES['thread-alert']
      );
      // A name that fits has nothing more to show.
      await page.mouse.move(0, 0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      const short = page
        .getByRole('group', { name: 'Echo entity knobs' })
        .locator('p')
        .getByText('Shared assets');
      await short.hover();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    });

    test('a suggestion card keeps a long item inside', async ({ page }) => {
      await open(page);
      const card = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: /Summarize alert threads/ }),
      });
      const trigger = card.locator('p [aria-label]');
      const edges = await across(card);
      expect((await across(trigger)).right).toBeLessThanOrEqual(edges.right);
      expect(await endsInEllipsis(trigger.getByText(ALERT))).toBe(true);
    });
  });
}
