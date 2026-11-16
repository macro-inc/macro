import { expect, test } from '@playwright/test';

// Writes and contact transports are fixture adapters. The importer, reference
// resolver, CSV conversion, property picker and window lifecycle are production.
test('import resolves exact assignees without a catalog and keeps ambiguity/address aliases unassigned', async ({
  page,
}) => {
  await page.goto('/?linear-import');
  await expect(page.getByTestId('import-reference-reads')).toHaveText('[]');
  await page.locator('input[type=file]').setInputFiles({
    name: 'tasks.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Title,Assignee\nLate,Private late name\nAmbiguous,Shared Name\nAddress,target@example.com\nComma,"Family, Given"'
    ),
  });
  await expect(
    page.getByRole('button', { name: 'Map Private late name', exact: true })
  ).toContainText('Private late name');
  await expect(
    page.getByRole('button', { name: 'Map Shared Name', exact: true })
  ).toContainText('Unassigned');
  await expect(
    page.getByText('Multiple exact matches', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Map target@example.com', exact: true })
  ).toContainText('Unassigned');
  await expect(
    page.getByRole('button', { name: 'Map Family, Given', exact: true })
  ).toContainText('Family, Given');
  await expect(page.getByTestId('import-picker-reads')).toHaveText('0');
  const submit = page.getByRole('button', {
    name: 'Import tasks',
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('import-write-count')).toHaveText('4');
  await expect(page.getByTestId('import-writes')).toContainText(
    'macro|person99999@example.com'
  );
  await expect(page.getByTestId('import-writes')).toContainText(
    'macro|comma@example.com'
  );
  await expect(page.getByTestId('import-writes')).not.toContainText(
    'macro|shared1@example.com'
  );
  await expect(page.getByTestId('import-writes')).not.toContainText(
    'macro|shared2@example.com'
  );
  await expect(page.getByTestId('import-writes')).not.toContainText(
    'macro|alias@example.com'
  );
  await expect(submit).toBeDisabled();
});

test('explicit Unassigned survives late inference but does not leak into the next uploaded file', async ({
  page,
}) => {
  await page.goto('/?linear-import');
  await page.getByRole('button', { name: 'Hold references' }).click();
  const file = page.locator('input[type=file]');
  await file.setInputFiles({
    name: 'first.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Title,Assignee\nFirst,Private late name'),
  });
  const mapping = page.getByRole('button', {
    name: 'Map Private late name',
    exact: true,
  });
  await mapping.click();
  await page.getByText('Unassigned', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Release references' }).click();
  await expect(page.getByTestId('import-reference-reads')).toContainText(
    'after-empty-budget'
  );
  await expect(mapping).toContainText('Unassigned');
  await page.getByRole('button', { name: 'Import tasks', exact: true }).click();
  await expect(page.getByTestId('import-write-count')).toHaveText('1');
  await expect(page.getByTestId('import-writes')).not.toContainText(
    'macro|person99999@example.com'
  );
  await file.setInputFiles({
    name: 'second.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Title,Assignee\nSecond,Private late name'),
  });
  await expect(mapping).toContainText('Private late name');
  await page.getByRole('button', { name: 'Import tasks', exact: true }).click();
  await expect(page.getByTestId('import-write-count')).toHaveText('2');
  await expect(page.getByTestId('import-writes')).toContainText(
    'macro|person99999@example.com'
  );
});

test('manual assignee selection pages, searches, keeps the chosen name and remains single-valued', async ({
  page,
}, info) => {
  await page.goto('/?linear-import');
  await page.locator('input[type=file]').setInputFiles({
    name: 'tasks.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Title,Assignee\nTask,Unknown'),
  });
  const mapping = page.getByRole('button', {
    name: 'Map Unknown',
    exact: true,
  });
  await mapping.click();
  const search = page.getByPlaceholder('Search assignees...');
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Person 000010' })
  ).toBeVisible();
  if (info.project.name === 'phone')
    await page.getByRole('button', { name: 'Next options', exact: true }).tap();
  else await search.press('PageDown');
  const next = page
    .locator('[data-entity-index]')
    .filter({ hasText: 'Person 000050' });
  await expect(next).toBeInViewport();
  await next.click();
  await expect(mapping).toContainText('Person 000050');
  await mapping.click();
  await search.fill('late');
  await expect(
    page
      .locator('[data-entity-index]')
      .filter({ hasText: 'Private late name' })
      .first()
  ).toBeVisible();
  await search.press('Enter');
  await expect(mapping).toContainText('Private late name');
  await page.getByRole('button', { name: 'Import tasks', exact: true }).click();
  await expect(page.getByTestId('import-write-count')).toHaveText('1');
  await expect(page.getByTestId('import-writes')).toContainText(
    'macro|person99999@example.com'
  );
  await expect(page.getByTestId('import-writes')).not.toContainText(
    'macro|person50@example.com'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test('offline incomplete evidence requires an explicit choice which survives reconnect', async ({
  page,
  context,
}) => {
  await page.goto('/?linear-import');
  await context.setOffline(true);
  await page.locator('input[type=file]').setInputFiles({
    name: 'tasks.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Title,Assignee\nTask,Private late name'),
  });
  await expect(
    page.getByText('Lookup unavailable', { exact: true })
  ).toBeVisible();
  const submit = page.getByRole('button', {
    name: 'Import tasks',
    exact: true,
  });
  await expect(submit).toBeDisabled();
  const mapping = page.getByRole('button', {
    name: 'Map Private late name',
    exact: true,
  });
  await mapping.click();
  await page.getByText('Unassigned', { exact: true }).last().click();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('import-reference-reads')).toContainText(
    'after-empty-budget'
  );
  await expect(mapping).toContainText('Unassigned');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('import-write-count')).toHaveText('1');
  await expect(page.getByTestId('import-writes')).not.toContainText(
    'macro|person99999@example.com'
  );
});

test('a late file read cannot replace a newer upload or its submitted assignees', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== 'old.csv') return read.call(this);
      document.documentElement.dataset.fileReadPending = 'true';
      return new Promise<string>((resolve) =>
        window.addEventListener(
          'release-file-text',
          () => resolve('Title,Assignee\nOld task,Private late name'),
          { once: true }
        )
      );
    };
  });
  await page.goto('/?linear-import');
  const file = page.locator('input[type=file]');
  await file.setInputFiles({
    name: 'old.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('old'),
  });
  await expect(page.locator('html')).toHaveAttribute(
    'data-file-read-pending',
    'true'
  );
  await file.setInputFiles({
    name: 'new.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Title,Assignee\nNew task,"Family, Given"'),
  });
  await expect(
    page.getByRole('button', { name: 'Map Family, Given', exact: true })
  ).toContainText('Family, Given');
  await page.evaluate(() =>
    window.dispatchEvent(new Event('release-file-text'))
  );
  await page.getByRole('button', { name: 'Import tasks', exact: true }).click();
  await expect(page.getByTestId('import-write-count')).toHaveText('1');
  await expect(page.getByTestId('import-writes')).toContainText('New task');
  await expect(page.getByTestId('import-writes')).toContainText(
    'macro|comma@example.com'
  );
  await expect(page.getByTestId('import-writes')).not.toContainText('Old task');
});

test('replacement login stops a running import before another task or history write', async ({
  page,
}) => {
  await page.goto('/?linear-import');
  await page.locator('input[type=file]').setInputFiles({
    name: 'tasks.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Title,Assignee\nFirst,Private late name\nSecond,Private late name'
    ),
  });
  const submit = page.getByRole('button', {
    name: 'Import tasks',
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await page.getByRole('button', { name: 'Hold task creation' }).click();
  await submit.click();
  await expect(page.getByTestId('import-write-count')).toHaveText('1');
  await expect(
    page.getByRole('button', { name: 'Clear', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Replace login' }).click();
  await page.getByRole('button', { name: 'Release task creation' }).click();
  await expect(page.getByTestId('import-history')).toHaveText('[]');
  await expect(page.getByTestId('import-write-count')).toHaveText('1');
  await expect(
    page.getByRole('button', { name: 'Map Private late name', exact: true })
  ).toHaveCount(0);
  await expect(submit).toBeDisabled();
});
