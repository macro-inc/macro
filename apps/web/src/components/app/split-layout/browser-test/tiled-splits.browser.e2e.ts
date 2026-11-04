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
