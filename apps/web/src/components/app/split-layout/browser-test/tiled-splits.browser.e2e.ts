import { expect, type Locator, type Page, test } from '@playwright/test';

const pane = (page: Page, label: string) =>
  page.locator(`section.pane[data-pane="${label}"]`);

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('pane is not laid out');

  return bounds;
}

const url = (page: Page) =>
  page.evaluate(() => Reflect.get(window, 'tiledSplitsUrl')() as string);

test('splitting a pane below keeps its content mounted and stacks the new pane under it', async ({
  page,
}) => {
  await page.goto('/');
  const home = pane(page, 'home');
  await home.getByRole('textbox').fill('A draft that must survive');
  const mount = await home.getAttribute('data-mount');

  await home.getByRole('button', { name: 'Split below' }).click();

  const drive = pane(page, 'drive');
  await expect(drive).toBeVisible();
  await expect(home).toHaveAttribute('data-mount', mount!);
  await expect(home.getByRole('textbox')).toHaveValue(
    'A draft that must survive'
  );

  const top = await box(home);
  const bottom = await box(drive);
  expect(top).toMatchObject({ x: 0, y: 0, width: 1200, height: 397 });
  expect(bottom).toMatchObject({ x: 0, y: 403, width: 1200, height: 397 });
  expect(await url(page)).toBe('/home/~/drive?layout=c2pp');
});

test('dragging and nudging the gutter between stacked panes resizes them, down to the minimum height', async ({
  page,
}) => {
  await page.goto('/');
  await pane(page, 'home').getByRole('button', { name: 'Split below' }).click();
  const gutter = page.getByRole('separator');
  await expect(gutter).toHaveAttribute('aria-orientation', 'horizontal');

  const start = await box(gutter);
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 100, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => (await box(pane(page, 'home'))).height)
    .toBe(497);
  expect((await box(pane(page, 'drive'))).height).toBe(297);

  await gutter.focus();
  await page.keyboard.press('ArrowUp');
  await expect
    .poll(async () => (await box(pane(page, 'home'))).height)
    .toBe(477);

  const moved = await box(gutter);
  await page.mouse.move(x, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, 1000, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => (await box(pane(page, 'drive'))).height)
    .toBe(240);
});

test('closing a stacked pane gives its column back and leaves the others mounted', async ({
  page,
}) => {
  await page.goto('/');
  await pane(page, 'home').getByRole('button', { name: 'Split right' }).click();
  const drive = pane(page, 'drive');
  await drive.getByRole('button', { name: 'Split below' }).click();
  const mail = pane(page, 'mail');
  await expect(mail).toBeVisible();
  expect(await url(page)).toBe('/home/~/drive/~/mail?layout=r2pc2pp');

  const homeMount = await pane(page, 'home').getAttribute('data-mount');
  const driveMount = await drive.getAttribute('data-mount');
  await expect(page.getByRole('separator')).toHaveCount(2);

  await mail.getByRole('button', { name: 'Close' }).click();

  await expect(mail).toHaveCount(0);
  await expect(page.getByRole('separator')).toHaveCount(1);
  expect(await box(drive)).toMatchObject({ x: 603, y: 0, height: 800 });
  await expect(pane(page, 'home')).toHaveAttribute('data-mount', homeMount!);
  await expect(drive).toHaveAttribute('data-mount', driveMount!);
  expect(await url(page)).toBe('/home/~/drive');
});

type ReadingMark = { paragraph: number; offset: number };

// The text at the top edge of a document's scroll container: which paragraph,
// and which character of it.
const textAtTop = (reader: Locator) =>
  reader.evaluate((scroller): ReadingMark => {
    const bounds = scroller.getBoundingClientRect();
    const caret = document.caretRangeFromPoint(
      bounds.left + 4,
      bounds.top + 4
    )!;
    const paragraphs = [...scroller.querySelectorAll('p')];
    return {
      paragraph: paragraphs.indexOf(caret.startContainer.parentElement!),
      offset: caret.startOffset,
    };
  });

// How far below the container's top edge that text now sits.
const distanceFromTop = (reader: Locator, mark: ReadingMark) =>
  reader.evaluate((scroller, { paragraph, offset }) => {
    const text = scroller.querySelectorAll('p')[paragraph]!.firstChild!;
    const range = document.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    return Math.round(
      range.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    );
  }, mark);

// The text the reader was at stays on the top line, within a line's height.
const expectStillAtTop = (reader: Locator, mark: ReadingMark) =>
  expect
    .poll(async () => Math.abs(await distanceFromTop(reader, mark)))
    .toBeLessThanOrEqual(LINE_HEIGHT);

const LINE_HEIGHT = 17;

test('closing the splits beside a document keeps the reader at the same text', async ({
  page,
}) => {
  await page.goto('/');
  const home = pane(page, 'home');
  // Each split opens right of home: home, document, mail, drive.
  for (let i = 0; i < 3; i++) {
    await home.getByRole('button', { name: 'Split right' }).click();
  }
  const document = pane(page, 'block');
  const reader = document.locator('[data-reading]');
  await expect(page.locator('section.pane')).toHaveCount(4);
  expect((await box(document)).x).toBeGreaterThan((await box(home)).x);
  expect((await box(document)).x).toBeLessThan(
    (await box(pane(page, 'mail'))).x
  );

  await reader.hover();
  await page.mouse.wheel(0, 2400);
  await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBe(2400);
  const mark = await textAtTop(reader);
  expect(mark.paragraph).toBeGreaterThan(10);

  // The split to its left closes.
  await home.getByRole('button', { name: 'Close' }).click();
  await expect(home).toHaveCount(0);
  await expectStillAtTop(reader, mark);

  // Then the splits to its right.
  for (const label of ['mail', 'drive']) {
    await pane(page, label).getByRole('button', { name: 'Close' }).click();
    await expect(pane(page, label)).toHaveCount(0);
    await expectStillAtTop(reader, mark);
  }
  expect((await box(document)).width).toBe(1200);
});
