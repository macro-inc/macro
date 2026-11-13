import { expect, test } from '@playwright/test';

test('read-only property controls keep project navigation available', async ({
  page,
}, info) => {
  await page.goto('/?scenario=collection&readOnly');
  const row = page.getByRole('row', { name: /Alpha launch/ });
  const priority =
    info.project.name !== 'phone'
      ? row.locator('.entity-slot[style*="grid-area: priority"] button')
      : row.getByRole('button', { name: 'Change priority', exact: true });
  await expect(priority).toHaveAttribute('aria-disabled', 'true');
  const bounds = await priority.boundingBox();
  if (!bounds) throw new Error('Missing readonly control geometry');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await expect(page.getByTestId('opened')).toHaveText('alpha');
  await expect(page.getByTestId('saved-property')).toBeEmpty();
});

test('empty project priority creates a value through the shared control', async ({
  page,
}, info) => {
  await page.goto('/?scenario=collection&noPriority');
  const row = page.getByRole('row', { name: /Alpha launch/ });
  const priority =
    info.project.name !== 'phone'
      ? row.locator('.entity-slot[style*="grid-area: priority"] button')
      : row.getByRole('button', { name: 'Change priority', exact: true });
  await priority.click();
  await page.getByRole('menu').getByText('High', { exact: true }).click();
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
test('project row keeps editable columns and a named progress ring at every device size', async ({
  page,
}, info) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/?scenario=collection');
  const row = page.getByRole('row', { name: /Alpha launch/ });
  await expect(row).toBeVisible();
  const priority =
    info.project.name !== 'phone'
      ? row.locator('.entity-slot[style*="grid-area: priority"] button')
      : row.getByRole('button', { name: 'Change priority', exact: true });
  const status =
    info.project.name !== 'phone'
      ? row.locator('.entity-slot[style*="grid-area: status"] button')
      : row.getByRole('button', { name: 'Change status', exact: true });
  const title = row.getByText('Alpha launch', { exact: true });
  const ring = row.getByRole('progressbar', { name: '1 of 3 done' });
  await expect(ring).toHaveAttribute('aria-valuenow', '1');
  await expect(ring).toHaveAttribute('aria-valuemax', '3');
  const priorityBox = await priority.boundingBox();
  const statusBox = await status.boundingBox();
  const titleBox = await title.boundingBox();
  const ringBox = await ring.boundingBox();
  expect(priorityBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(ringBox).not.toBeNull();
  if (!priorityBox || !statusBox || !titleBox || !ringBox)
    throw new Error('Missing row geometry');
  expect(titleBox.x).toBeLessThan(ringBox.x);
  expect(ringBox.width).toBe(22);
  if (info.project.name === 'desktop') {
    await ring.focus();
    await expect(page.getByRole('tooltip')).toContainText('1 of 3 done');
  }
  expect(
    await ring
      .locator('svg')
      .evaluate((svg) => svg.getBoundingClientRect().width)
  ).toBe(14);
  expect(ringBox.x).toBeLessThan(statusBox.x);
  expect(statusBox.x).toBeLessThan(priorityBox.x);
  if (info.project.name === 'phone') {
    expect((await row.boundingBox())?.height).toBe(44);
    const lead = row.getByRole('button', { name: 'Change assignees' });
    await expect(lead.locator('[class*="group/avatar"]')).toHaveCount(1);
    const leadBox = await lead.boundingBox();
    if (!leadBox) throw new Error('Missing lead avatar geometry');
    expect(priorityBox.x).toBeLessThan(leadBox.x);
  }
  await page.screenshot({ path: `/tmp/project-row-${info.project.name}.png` });
  await priority.click();
  await page.getByRole('menu').getByText('High', { exact: true }).click();
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

test('project columns retain Updated through 840px and collapse at 600px', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/?scenario=collection');
  await expect(page.getByRole('row', { name: /Alpha launch/ })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 800 });
  const grid = page.getByRole('grid', { name: 'Projects' });
  await expect(
    grid.getByRole('columnheader', { name: 'Status' }).locator('svg')
  ).toBeVisible();
  await expect(
    grid.getByRole('columnheader', { name: 'Priority' }).locator('svg')
  ).toBeVisible();
  await expect(
    grid.getByRole('columnheader', { name: 'Due date' }).locator('svg')
  ).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'Tasks' })).toHaveCount(
    0
  );
  const updated = grid.locator('.task-updated-cell').last();
  await expect(updated).toHaveCSS('opacity', '1');
  await expect(updated).toHaveCSS('visibility', 'visible');
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(updated).toHaveCSS('opacity', '0');
  await expect(updated).toHaveCSS('visibility', 'hidden');
  await page.screenshot({ path: '/tmp/project-row-narrow-columns.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(updated).toHaveCSS('transition-duration', '0s');
});
