import { expect, type Page, test } from '@playwright/test';

const PATH =
  '/src/features/channel/Call/CallControls/browser-test/call-sharing.html';

// A desktop menu's radio is `menuitemradio`; a phone drawer's is `radio`.
function teamSharing(page: Page) {
  return page
    .locator('[role="radio"], [role="menuitemradio"]')
    .filter({ hasText: 'Team sharing' });
}

async function openMenu(page: Page, role: string) {
  await page.route('**/__macro_dev/**', (route) =>
    route.fulfill({ json: { data: [] } })
  );
  await page.goto(`${PATH}?role=${role}`);
  await page.getByRole('button', { name: 'Call sharing: Private' }).click();
}

test('someone the change waits on can approve it, and the options wait', async ({
  page,
}) => {
  await openMenu(page, 'approver');

  await expect(
    page.getByText('wants to share this call with the team')
  ).toBeVisible();
  await expect(teamSharing(page)).toBeDisabled();

  await page.getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(teamSharing(page)).toBeEnabled();
});

test('someone the change waits on can decline it', async ({ page }) => {
  await openMenu(page, 'approver');

  await page.getByRole('button', { name: 'Decline' }).click();

  await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0);
});

test('the requester sees who it waits on and can withdraw it', async ({
  page,
}) => {
  await openMenu(page, 'requester');

  await expect(page.getByText(/^Waiting for .+ to approve$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancel request' }).click();

  await expect(
    page.getByRole('button', { name: 'Cancel request' })
  ).toHaveCount(0);
});

test('with nothing pending, choosing an option proposes it', async ({
  page,
}) => {
  await openMenu(page, 'none');

  await teamSharing(page).click();

  await expect(page.getByTestId('toggles')).toHaveText('1');
});
