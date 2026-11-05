import { expect, type Page, test } from '@playwright/test';

const frameFor = (page: Page, id: string) =>
  page
    .locator(`[data-canvas-artifact="${id}"]`)
    .locator('iframe[data-canvas-artifact-frame]');

test('runs an artifact, passes input only while interacting', async ({
  page,
}) => {
  await page.goto('/artifact.html?edit');
  const node = page.locator('[data-canvas-artifact="First"]');
  const frame = frameFor(page, 'First');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveCSS('pointer-events', 'none');

  await node.hover();
  await node.getByRole('button', { name: 'Interact' }).click();
  await expect(frame).toHaveCSS('pointer-events', 'auto');

  const target = frame.contentFrame().locator('#target');
  // The frame draws at half its design size. Playwright's element coordinates
  // ignore that scale, so click where the button appears on screen. Input can
  // reach the canvas until the frame's new hit-test region has been painted.
  await expect(async () => {
    await page.mouse.click(110, 108);
    await expect(target).toHaveText('clicked', { timeout: 500 });
  }).toPass();

  await node.getByRole('button', { name: 'Done' }).click();
  await expect(frame).toHaveCSS('pointer-events', 'none');
});

test('edits an artifact from the inspector', async ({ page }) => {
  await page.goto('/artifact.html?edit');
  await frameFor(page, 'First').waitFor();
  await page.mouse.click(200, 150);

  const html = page.getByLabel('Artifact HTML');
  await expect(html).toBeVisible();
  await html.fill('<p id="edited">Edited</p>');
  await html.blur();

  await expect(
    frameFor(page, 'First').contentFrame().locator('#edited')
  ).toHaveText('Edited');
});

test('presents artifacts in order, with keys working from inside a frame', async ({
  page,
}) => {
  await page.goto('/artifact.html?edit');
  const node = page.locator('[data-canvas-artifact="First"]');
  await frameFor(page, 'First').waitFor();
  await node.hover();
  await node.getByRole('button', { name: 'Present' }).click();

  const show = page.locator('[data-canvas-artifact-presentation]');
  const counter = page.getByTestId('canvas-artifact-presentation-counter');
  const target = show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('#target');
  await expect(counter).toHaveText('1 / 2');
  await expect(target).toHaveText('First');

  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 2');
  await expect(target).toHaveText('Second');

  // Stops at the end rather than wrapping.
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('2 / 2');

  await page.getByRole('button', { name: 'Previous artifact' }).click();
  await expect(counter).toHaveText('1 / 2');

  // With focus inside the frame, keys reach the host only through its bridge.
  await show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('body')
    .evaluate((body) => {
      body.tabIndex = 0;
      body.focus();
    });
  await show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('body')
    .press('ArrowRight');
  await expect(counter).toHaveText('2 / 2');
  await show
    .locator('iframe[data-canvas-artifact-frame]')
    .contentFrame()
    .locator('body')
    .press('Escape');
  await expect(show).toHaveCount(0);
});

test('reorders the presentation from the inspector', async ({ page }) => {
  await page.goto('/artifact.html?edit');
  await frameFor(page, 'First').waitFor();
  await page.mouse.click(200, 150);

  await expect(page.getByText('Presented 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByText('Presented 2 of 2')).toBeVisible();

  // The selection overlay covers the node's own controls while it is selected.
  await page
    .getByRole('region', { name: 'Artifact' })
    .getByRole('button', { name: 'Present' })
    .click();
  await expect(
    page.getByTestId('canvas-artifact-presentation-counter')
  ).toHaveText('2 / 2');
});

test('double-clicking a selected artifact starts interacting', async ({
  page,
}) => {
  await page.goto('/artifact.html?edit');
  const frame = frameFor(page, 'First');
  await frame.waitFor();
  await page.mouse.click(200, 150);
  await expect(page.getByLabel('Artifact HTML')).toBeVisible();

  await page.mouse.dblclick(200, 150);
  await expect(frame).toHaveCSS('pointer-events', 'auto');
});
