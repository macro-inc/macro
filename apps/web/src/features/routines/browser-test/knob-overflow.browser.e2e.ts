import { expect, type Locator, type Page, test } from '@playwright/test';

const FIXTURE = '/src/features/routines/browser-test/knobs.html';
const ALERT = /^Alert: insight 'GraphQL soup/;

const WIDTHS = [
  { name: 'desktop', viewport: { width: 1200, height: 900 }, touch: false },
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

/** Whether a name is cut short, ending in an ellipsis. */
function isCut(locator: Locator) {
  return locator.evaluate(
    (element) => element.scrollWidth > element.clientWidth
  );
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
        const values = await knobBoxes(card);
        expect(values.length).toBeGreaterThan(0);
        for (const value of values) {
          expect(value.left, value.label).toBeGreaterThanOrEqual(edges.left);
          expect(value.right, value.label).toBeLessThanOrEqual(edges.right);
        }
      }
      expect(errors).toEqual([]);
    });

    test('a sentence of many items wraps within its card', async ({ page }) => {
      await open(page);
      const card = page.getByRole('group', { name: 'Echo entity knobs' });
      const sentence = card.locator('p').filter({ hasText: /^Read / });
      const edges = await across(card);
      const text = await across(sentence);
      expect(text.right).toBeLessThanOrEqual(edges.right);
      // Short items sit side by side on lines, not one to a line.
      const lines = await sentence.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(
          [...range.getClientRects()].map((rect) => Math.round(rect.top))
        ).size;
      });
      expect(lines).toBeGreaterThan(1);
      expect(lines).toBeLessThan(12);
      // Short names show whole.
      expect(await isCut(sentence.getByText('product-launch').first())).toBe(
        false
      );
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
        expect(await isCut(subject)).toBe(true);
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
      // The label reads on one line beside its value.
      expect(
        await label.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      expect((await label.boundingBox())!.height).toBeLessThan(30);
      // A short value beside it shows whole.
      expect(await isCut(card.locator('dd').getByText('Shared assets'))).toBe(
        false
      );
    });

    test('a suggestion card keeps a long item inside', async ({ page }) => {
      await open(page);
      const card = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: /Summarize alert threads/ }),
      });
      const value = card.locator('p').getByText(ALERT);
      const edges = await across(card);
      expect((await across(value)).right).toBeLessThanOrEqual(edges.right);
    });
  });
}
