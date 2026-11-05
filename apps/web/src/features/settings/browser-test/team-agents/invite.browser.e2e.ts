import { expect, test } from '@playwright/test';

test('reviews the price and confirms once with reachable actions', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise and helpful');
  const review = page.getByRole('button', { name: 'Review price' });
  const bounds = await review.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height
  );
  await review.click();
  await expect(page.getByText('Total per month')).toBeVisible();
  await expect(page.getByText('$50.00')).toBeVisible();
  await expect(page.getByText('Purchases: 0')).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm and invite' });
  await expect(confirm).toBeInViewport();
  await confirm.click();
  await expect(page.getByText('Purchases: 1')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Invite agent', exact: true })
  ).toBeFocused();
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
});

test('recovers a quote error without purchasing', async ({ page }) => {
  await page.goto('/?quote-error');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise');
  await page.getByRole('button', { name: 'Review price' }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm and invite' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm and invite' })
  ).toBeEnabled();
  await expect(page.getByText('Purchases: 0')).toBeVisible();
});

test('keeps phone actions above the keyboard while long fields scroll', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone');
  await page.goto('/');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page
    .getByLabel('Role / job description')
    .fill('A long responsibility. '.repeat(80));
  await page.getByLabel('Personality').fill('Helpful and concise. '.repeat(80));
  await page.evaluate(() =>
    document.documentElement.style.setProperty(
      '--virtual-keyboard-height',
      '280px'
    )
  );
  const review = page.getByRole('button', { name: 'Review price' });
  await expect(review).toBeInViewport();
  await expect
    .poll(async () => {
      const bounds = await review.boundingBox();
      return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(page.viewportSize()!.height - 280);
  await review.click();
  await expect(
    page.getByRole('button', { name: 'Confirm and invite' })
  ).toBeInViewport();
});
