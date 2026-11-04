import { expect, type Page, test } from '@playwright/test';

async function removed(page: Page) {
  await page
    .getByRole('button', { name: 'People display options', exact: true })
    .click();
  const checkbox = page.getByRole('menuitemcheckbox', {
    name: 'Show removed people',
  });
  await expect(checkbox).toBeInViewport({ ratio: 1 });
  await checkbox.click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', { name: 'Removed people', exact: true })
  ).toBeVisible();
}
async function confirm(page: Page, action: string) {
  await page.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toHaveAttribute('data-transitioning');
  await dialog.getByRole('button', { name: action, exact: true }).click();
}
const results = (page: Page) =>
  page.getByRole('region', { name: 'People results' });

test.beforeEach(async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto('/');
  await expect(
    results(page).getByRole('button', { name: 'Active person', exact: true })
  ).toBeVisible();
});

test('admin hides, discovers through removed search, and restores with the existing eye', async ({
  page,
}, info) => {
  await results(page).getByRole('button', { name: 'Active person' }).click();
  await confirm(page, 'Remove from CRM');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    results(page).getByRole('button', { name: 'Active person' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to People' }).click();
  await removed(page);
  await page.getByRole('searchbox', { name: 'Search people' }).fill('Active');
  await results(page).getByRole('button', { name: 'Active person' }).click();
  await expect(page.getByLabel('Contact identity')).toHaveText(
    'active / company-1'
  );
  await page.screenshot({
    path: info.outputPath('removed-people-restore.png'),
  });
  await confirm(page, 'Restore to CRM');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    results(page).getByRole('button', { name: 'Active person' })
  ).toHaveCount(0);
  await expect(results(page).getByText('No removed people')).toBeVisible();
  await page.getByRole('button', { name: 'Back to People' }).click();
  await page
    .getByRole('button', { name: 'Show active people', exact: true })
    .click();
  await expect(
    results(page).getByRole('button', { name: 'Active person' })
  ).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('Active');
  await expect(page.getByLabel('Successful writes')).toHaveText('2');
  await page.screenshot({ path: info.outputPath('people-restored.png') });
});

test('server pagination and search find later removed rows, handle errors and preserve hidden-parent semantics', async ({
  page,
}, info) => {
  await removed(page);
  await expect(
    results(page).getByRole('button', { name: 'Removed paged' })
  ).toHaveCount(0);
  await results(page).getByRole('button', { name: 'Load more' }).click();
  await expect(
    results(page).getByRole('button', { name: 'Removed paged' })
  ).toBeVisible();
  await expect(
    results(page).getByRole('button', { name: 'Other team removed' })
  ).toHaveCount(0);
  const requests = JSON.parse(
    (await page.getByLabel('Requests', { exact: true }).textContent()) ?? '[]'
  );
  expect(
    requests.some((request: { continuation?: unknown }) => request.continuation)
  ).toBe(true);
  await page.getByRole('searchbox').fill('paged@example.com');
  await expect(
    results(page).getByRole('button', { name: 'Removed paged' })
  ).toBeVisible();
  await expect(
    results(page).getByRole('button', { name: 'Removed first' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Fail next query' }).click();
  await page.getByRole('searchbox').fill('Hidden company');
  await expect(page.getByRole('alert')).toHaveText('Could not load people');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await results(page)
    .getByRole('button', { name: 'Hidden company person' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Restore to CRM', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText(/stay removed until their company is restored/)
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('removed-hidden-company.png'),
  });
  await page.getByRole('searchbox').fill('no-match');
  await expect(results(page).getByText('No removed people')).toBeVisible();
});

test('unfiled records restore, rejected writes stay retryable, and scope changes close removed mode', async ({
  page,
}) => {
  await results(page).getByRole('button', { name: 'Unfiled person' }).click();
  await page.getByRole('button', { name: 'Fail next write' }).click();
  await confirm(page, 'Remove from CRM');
  await expect(page.getByRole('alert', { includeHidden: true })).toHaveText(
    'Could not update contact visibility'
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove from CRM', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to People' }).click();
  await removed(page);
  await page.getByRole('searchbox').fill('Unfiled');
  await results(page).getByRole('button', { name: 'Unfiled person' }).click();
  await confirm(page, 'Restore to CRM');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Contact identity')).toHaveText(
    'unfiled / unfiled'
  );
  await expect(results(page).getByText('No removed people')).toBeVisible();
  await page.getByRole('button', { name: 'Back to People' }).click();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Switch team' }).click();
  await expect(
    page.getByRole('heading', { name: 'People', exact: true })
  ).toBeVisible();
  await removed(page);
  await expect(
    results(page).getByRole('button', { name: 'Other team removed' })
  ).toBeVisible();
  await expect(
    results(page).getByRole('button', { name: 'Removed first' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(
    page.getByRole('heading', { name: 'People', exact: true })
  ).toBeVisible();
  await removed(page);
  await page.getByRole('button', { name: 'Toggle list' }).click();
  await page.getByRole('button', { name: 'Toggle list' }).click();
  await expect(
    page.getByRole('heading', { name: 'People', exact: true })
  ).toBeVisible();
  await removed(page);
  await page
    .getByRole('button', { name: 'Toggle member', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'People display options' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Inject hidden filters' }).click();
  await expect(
    results(page).getByRole('button', { name: /Removed|Other team/ })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Open removed directly' }).click();
  await expect(page.getByText('Contact unavailable')).toBeVisible();
});

test('loading and late removed responses cannot resurrect rows after a role change', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Hold next query' }).click();
  await removed(page);
  await expect(results(page).getByRole('status')).toHaveText('Loading people');
  await expect(
    results(page).getByRole('button', { name: /Removed/ })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Toggle member', exact: true })
    .click();
  await page.getByRole('button', { name: 'Release query' }).click();
  await expect(
    page.getByRole('heading', { name: 'People', exact: true })
  ).toBeVisible();
  await expect(
    results(page).getByRole('button', { name: 'Active person' })
  ).toBeVisible();
  await expect(
    results(page).getByRole('button', {
      name: /Removed|Other team|Hidden company/,
    })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'People display options' })
  ).toHaveCount(0);
});
