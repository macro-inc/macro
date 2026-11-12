import { expect, test } from '@playwright/test';

test('read-only property controls keep project navigation available', async ({
  page,
}) => {
  await page.goto('/?scenario=collection&readOnly');
  const row = page.getByRole('row', { name: /Alpha launch/ });
  const priority = row.getByRole('button', {
    name: 'Change priority',
    exact: true,
  });
  await expect(priority).toHaveAttribute('aria-disabled', 'true');
  await priority.click({ force: true });
  await expect(page.getByTestId('opened')).toHaveText('alpha');
  await expect(page.getByTestId('saved-property')).toBeEmpty();
});

test('empty project priority creates a value through the shared control', async ({
  page,
}) => {
  await page.goto('/?scenario=collection&noPriority');
  const row = page.getByRole('row', { name: /Alpha launch/ });
  await row
    .getByRole('button', { name: 'Change priority', exact: true })
    .click();
  await page.getByText('High', { exact: true }).click();
  await expect(page.getByTestId('saved-property')).toContainText('alpha:');
  await expect(page.getByTestId('saved-property')).toContainText(
    '00000001-0000-0000-0003-000000000003'
  );
  await expect(page.getByTestId('project-records')).toContainText(
    '00000001-0000-0000-0003-000000000003'
  );
  await expect(page.getByTestId('opened')).toBeEmpty();
});

// Exercise the actual project row and shared property editors, not a markup copy.
test('project row leads with editable priority and status at every device size', async ({
  page,
}, info) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/?scenario=collection');
  const row = page.getByRole('row', { name: /Alpha launch/ });
  await expect(row).toBeVisible();
  const priority = row.getByRole('button', {
    name: 'Change priority',
    exact: true,
  });
  const status = row.getByRole('button', {
    name: 'Change status',
    exact: true,
  });
  const title = row.getByText('Alpha launch', { exact: true });
  const priorityBox = await priority.boundingBox();
  const statusBox = await status.boundingBox();
  const titleBox = await title.boundingBox();
  expect(priorityBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  if (!priorityBox || !statusBox || !titleBox)
    throw new Error('Missing row geometry');
  expect(priorityBox.x).toBeLessThan(statusBox.x);
  expect(statusBox.x).toBeLessThan(titleBox.x);
  expect(priorityBox.height).toBe(info.project.name === 'desktop' ? 24 : 36);
  expect(statusBox.height).toBe(info.project.name === 'desktop' ? 24 : 36);
  const statusIcon = await status.locator('svg').boundingBox();
  const priorityIcon = await priority.locator('svg').boundingBox();
  expect(statusIcon?.width).toBe(18);
  expect(priorityIcon?.width).toBe(info.project.name === 'phone' ? 20 : 16);
  if (info.project.name === 'phone')
    expect((await row.boundingBox())?.height).toBe(44);
  await page.screenshot({ path: `/tmp/project-row-${info.project.name}.png` });
  await priority.click();
  await page.getByText('High', { exact: true }).click();
  await expect(priority).toBeVisible();
  await expect(page.getByTestId('saved-property')).toContainText('alpha:');
  await expect(page.getByTestId('saved-property')).toContainText(
    '00000001-0000-0000-0003-000000000003'
  );
  await status.click();
  await page.getByText('Done', { exact: true }).last().click();
  await expect(page.getByTestId('opened')).toBeEmpty();
  await expect(page.getByTestId('saved-property')).toContainText('alpha:');
  await expect(page.getByTestId('saved-property')).toContainText(
    '"values":["done"]'
  );
});

test('project columns share narrow collapse and reduced-motion behavior', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/?scenario=collection');
  await expect(page.getByRole('row', { name: /Alpha launch/ })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 800 });
  const dueHeader = page.getByRole('columnheader', {
    name: 'Due date',
    exact: true,
  });
  await expect(dueHeader.locator('svg')).toBeVisible();
  const updated = page
    .getByRole('grid', { name: 'Projects' })
    .locator('.task-updated-cell')
    .last();
  const progress = page
    .getByRole('grid', { name: 'Projects' })
    .locator('.task-progress-cell')
    .last();
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(updated).toHaveCSS('opacity', '0');
  await expect(progress).toHaveCSS('opacity', '0');
  await expect(updated).toHaveCSS('visibility', 'hidden');
  await expect(progress).toHaveCSS('visibility', 'hidden');
  await page.screenshot({ path: '/tmp/project-row-narrow-columns.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(updated).toHaveCSS('transition-duration', '0s');
  await expect(progress).toHaveCSS('transition-duration', '0s');
});
