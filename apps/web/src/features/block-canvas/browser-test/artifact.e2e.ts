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
  await target.click();
  await expect(target).toHaveText('clicked');

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
