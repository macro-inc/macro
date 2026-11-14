import { expect, type Page, test } from '@playwright/test';

const control = (page: Page) => page.locator('[data-refresh]');
const requests = (page: Page) => page.getByRole('list', { name: 'Requests' });

test('Refresh suggestions asks once, shows the run, then says when the next may be', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const refresh = page.getByRole('button', { name: 'Refresh suggestions' });
  await expect(refresh).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('refresh-ready.png') });

  await refresh.click();
  await expect(control(page)).toHaveAttribute('data-refresh', 'running');
  const running = control(page).getByRole('button');
  await expect(running).toHaveText('Looking for suggestions');
  await expect(running).toBeDisabled();
  await expect(requests(page).getByText('regenerate')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('refresh-running.png') });

  await page.getByRole('button', { name: 'Finish generation' }).click();
  await expect(control(page)).toHaveAttribute('data-refresh', 'cooldown');
  const waiting = control(page).getByRole('button');
  await expect(waiting).toHaveText(/^Available at \d{1,2}:\d{2} (AM|PM)$/);
  await expect(waiting).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('refresh-cooldown.png') });
});

test('a generation someone else started shows as running, with no way to ask for another', async ({
  page,
}) => {
  await page.goto('/?generation=running');

  await expect(control(page).getByRole('button')).toHaveText(
    'Looking for suggestions'
  );
  await expect(control(page).getByRole('button')).toBeDisabled();
  // The cards stay usable while suggestions are looked for.
  await expect(page.locator('[data-suggestion]')).toHaveCount(9);
});

test('the control turns ready by itself when the cooldown ends', async ({
  page,
}) => {
  await page.goto('/?generation=cooldown&cooldownMs=1500');
  await expect(control(page)).toHaveAttribute('data-refresh', 'cooldown');

  await expect(
    page.getByRole('button', { name: 'Refresh suggestions' })
  ).toBeEnabled();
});

test('a refresh that didn’t get through says so and can be asked again', async ({
  page,
}) => {
  await page.goto('/?regenerate=fails');
  await page.getByRole('button', { name: 'Refresh suggestions' }).click();

  await expect(control(page).getByRole('alert')).toHaveText(
    'Couldn’t refresh. Try again.'
  );
  await expect(
    page.getByRole('button', { name: 'Refresh suggestions' })
  ).toBeEnabled();
});

test('no control where the server can’t say whether a generation runs', async ({
  page,
}) => {
  await page.goto('/?generation=none');

  await expect(page.locator('[data-suggestion]')).toHaveCount(9);
  await expect(control(page)).toHaveCount(0);
});
