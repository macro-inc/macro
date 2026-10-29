import { expect, test } from '@playwright/test';

test('choose a private exchange and preserve its audience for an ephemeral agent', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const visibility = page.getByRole('button', { name: 'Message visibility' });
  await expect(visibility).toContainText('Everyone');
  await visibility.click();
  await page
    .getByRole('menuitemradio', { name: 'Only you', exact: true })
    .click();
  await expect(visibility).toContainText('Only you');
  await page.getByText('Ephemeral agent mentioned', { exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Ephemeral agent mentioned' })
  ).toBeChecked();
  await visibility.click();
  await expect(
    page.getByRole('menuitemradio', { name: 'Everyone', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByText('@Research is an ephemeral agent.', { exact: false })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByText('Ephemeral agent mentioned', { exact: true }).click();
  await expect(visibility).toContainText('Only you');
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('private-thread.png') });
});
