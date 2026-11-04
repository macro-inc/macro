import { expect, type Page, test } from '@playwright/test';

async function confirmVisibility(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  if (label === 'Restore') return;
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(dialog).not.toHaveAttribute('data-transitioning');
  await dialog.getByRole('button', { name: label, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto('/');
});

test('admin Team excludes removed rows and refreshes after navigating away to hide and restore', async ({
  page,
}, info) => {
  const visible = page.getByRole('button', { name: /Visible person/ });
  await expect(visible).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Removed person/ })
  ).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search team' }).fill('removed');
  await expect(page.getByText('No matching contacts.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search team' }).fill('');
  await page.screenshot({ path: info.outputPath('team-before.png') });
  await visible.click();
  await expect(page.getByRole('region', { name: 'Team' })).toHaveCount(0);
  await confirmVisibility(page, 'Archive');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Contact identity')).toHaveText(
    'visible-contact / company-1'
  );
  await page.getByRole('button', { name: 'Company Team', exact: true }).click();
  await expect(page.getByText('No contacts yet')).toBeVisible();
  await expect(visible).toHaveCount(0);
  await expect(page.getByLabel('Company reads')).toHaveText('2');
  await page.screenshot({ path: info.outputPath('team-removed.png') });
  await page.getByRole('button', { name: 'Open contact directly' }).click();
  await confirmVisibility(page, 'Restore');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Company Team', exact: true }).click();
  await expect(visible).toBeVisible();
  await expect(page.getByLabel('Successful writes')).toHaveText('2');
  await expect(page.getByLabel('Company reads')).toHaveText('3');
  await page.screenshot({ path: info.outputPath('team-restored.png') });
});

test('mounted Team updates on hide and restore; rejected writes and member controls preserve state', async ({
  page,
}) => {
  await expect(
    page.getByRole('button', { name: /Visible person/ })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep Team mounted' }).click();
  await page.getByRole('button', { name: /Visible person/ }).click();
  await page.getByRole('button', { name: 'Fail next write' }).click();
  await confirmVisibility(page, 'Archive');
  await expect(
    page
      .getByRole('alert', { includeHidden: true })
      .filter({ hasText: 'Could not update contact visibility' })
  ).toHaveText('Could not update contact visibility');
  await expect(
    page.getByRole('button', { name: /Visible person/, includeHidden: true })
  ).toBeVisible();
  await expect(page.getByLabel('Successful writes')).toHaveText('0');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Visible person/ })
  ).toHaveCount(0);
  await confirmVisibility(page, 'Restore');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Visible person/ })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Toggle member role' }).click();
  await expect(
    page.getByRole('button', { name: 'Archive', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Open removed directly' }).click();
  await expect(page.getByText('Contact unavailable')).toBeVisible();
});

test('unfiled contact keeps its identity through removal and restoration', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open unfiled directly' }).click();
  await confirmVisibility(page, 'Archive');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Contact identity')).toHaveText(
    'unfiled-contact / unfiled'
  );
  await confirmVisibility(page, 'Restore');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Contact identity')).toHaveText(
    'unfiled-contact / unfiled'
  );
  await page.getByRole('button', { name: 'Company Team', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Visible person/ })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Unfiled person/ })
  ).toHaveCount(0);
});
